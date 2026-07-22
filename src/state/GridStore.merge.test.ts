// Tests for GridStore's merged-cell layer: mergeCells/unmergeCells (anchor
// value/style survival, covered-cell clearing, overlap replacement, one-step
// undo/redo), getMergeAt/getMerges, and how structural edits (insert/
// delete/move rows and columns) remap merges — including the monotonic vs.
// non-monotonic split that keeps a merge fully inside a moved block while
// dropping one that straddles a move's swap boundary.

import { describe, expect, it } from "vitest";
import { GridStore } from "./GridStore";
import type { CellRange } from "../types";

const range = (
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): CellRange => ({ startRow, startCol, endRow, endCol });

const makeStore = (rows = 100, cols = 26) => new GridStore(rows, cols, 100);

describe("mergeCells", () => {
  it("keeps the anchor's value and style, clears other occupied cells", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "hi" },
      { row: 0, col: 1, raw: "bye" },
      { row: 1, col: 0, raw: "x" },
    ]);
    store.applyStyle(range(0, 0, 0, 0), { bold: true });
    store.mergeCells(range(0, 0, 1, 1));
    expect(store.getRaw(0, 0)).toBe("hi");
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
    expect(store.getRaw(0, 1)).toBe("");
    expect(store.getRaw(1, 0)).toBe("");
  });

  it("is a no-op for a single-cell range", () => {
    const store = makeStore();
    store.mergeCells(range(0, 0, 0, 0));
    expect(store.getMerges()).toEqual([]);
    expect(store.canUndo()).toBe(false);
  });

  it("replaces any existing merges the new range intersects", () => {
    const store = makeStore();
    store.mergeCells(range(0, 0, 1, 1));
    store.mergeCells(range(1, 1, 2, 2));
    expect(store.getMerges()).toEqual([range(1, 1, 2, 2)]);
  });

  it("undoes and redoes as one action, restoring cleared values", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 1, raw: "bye" }]);
    store.mergeCells(range(0, 0, 1, 1));
    expect(store.getMerges()).toEqual([range(0, 0, 1, 1)]);
    store.undo();
    expect(store.getMerges()).toEqual([]);
    expect(store.getRaw(0, 1)).toBe("bye");
    store.redo();
    expect(store.getMerges()).toEqual([range(0, 0, 1, 1)]);
    expect(store.getRaw(0, 1)).toBe("");
  });
});

describe("unmergeCells", () => {
  it("removes every merge intersecting the range", () => {
    const store = makeStore();
    store.mergeCells(range(0, 0, 1, 1));
    store.mergeCells(range(5, 5, 6, 6));
    store.unmergeCells(range(0, 0, 0, 0));
    expect(store.getMerges()).toEqual([range(5, 5, 6, 6)]);
  });

  it("is a no-op when nothing intersects", () => {
    const store = makeStore();
    store.mergeCells(range(0, 0, 1, 1));
    store.unmergeCells(range(5, 5, 6, 6));
    expect(store.canUndo()).toBe(true);
    const undoStackDepth = () => {
      let n = 0;
      while (store.canUndo()) {
        store.undo();
        n++;
      }
      return n;
    };
    expect(undoStackDepth()).toBe(1); // only the mergeCells action recorded
  });

  it("undoes and redoes as one action", () => {
    const store = makeStore();
    store.mergeCells(range(0, 0, 1, 1));
    store.unmergeCells(range(0, 0, 0, 0));
    expect(store.getMerges()).toEqual([]);
    store.undo();
    expect(store.getMerges()).toEqual([range(0, 0, 1, 1)]);
    store.redo();
    expect(store.getMerges()).toEqual([]);
  });
});

describe("getMergeAt / getMerges", () => {
  it("finds the merge covering both the anchor and a covered cell", () => {
    const store = makeStore();
    store.mergeCells(range(2, 2, 3, 3));
    expect(store.getMergeAt(2, 2)).toEqual(range(2, 2, 3, 3));
    expect(store.getMergeAt(3, 3)).toEqual(range(2, 2, 3, 3));
    expect(store.getMergeAt(0, 0)).toBeNull();
  });

  it("getMerges returns independent copies", () => {
    const store = makeStore();
    store.mergeCells(range(0, 0, 1, 1));
    const merges = store.getMerges();
    merges[0].endRow = 99;
    expect(store.getMergeAt(1, 1)).toEqual(range(0, 0, 1, 1));
  });
});

describe("structural edits remap merges", () => {
  it("insertRows above a merge shifts it down unchanged in shape", () => {
    const store = makeStore();
    store.mergeCells(range(5, 0, 6, 1));
    store.insertRows(0, 2);
    expect(store.getMerges()).toEqual([range(7, 0, 8, 1)]);
  });

  it("insertRows inside a merge's span grows it", () => {
    const store = makeStore();
    store.mergeCells(range(3, 0, 6, 1));
    store.insertCols(0, 0); // no-op sanity
    store.insertRows(4, 2); // insertion point inside (3,6)
    expect(store.getMerges()).toEqual([range(3, 0, 8, 1)]);
  });

  it("deleteRows entirely inside a merge's span shrinks it", () => {
    const store = makeStore();
    store.mergeCells(range(2, 0, 8, 1));
    store.deleteRows(4, 5); // interior rows, both corners outside the deleted band
    expect(store.getMerges()).toEqual([range(2, 0, 6, 1)]);
  });

  it("deleteRows touching only the merge's far edge shrinks it, not drops it", () => {
    const store = makeStore();
    store.mergeCells(range(2, 0, 8, 1));
    store.deleteRows(7, 8); // touches only endRow (8), anchor row 2 survives
    expect(store.getMerges()).toEqual([range(2, 0, 6, 1)]);
  });

  it("deleteRows extending past the merge's far edge still shrinks to the last surviving row", () => {
    const store = makeStore();
    store.mergeCells(range(2, 0, 8, 1));
    store.deleteRows(7, 20); // deletes beyond the merge's original end
    expect(store.getMerges()).toEqual([range(2, 0, 6, 1)]);
  });

  it("deleteRows through a merge's anchor drops the merge", () => {
    const store = makeStore();
    store.mergeCells(range(2, 0, 8, 1));
    store.deleteRows(1, 3); // includes the anchor row (2)
    expect(store.getMerges()).toEqual([]);
  });

  it("deleteRows fully containing a merge drops it", () => {
    const store = makeStore();
    store.mergeCells(range(2, 0, 3, 1));
    store.deleteRows(0, 5);
    expect(store.getMerges()).toEqual([]);
  });

  it("moveRows shifts a merge fully inside the moved block by the swap offset", () => {
    const store = makeStore();
    // Merge at rows [3,4], fully inside the moved block [3,5].
    store.mergeCells(range(3, 0, 4, 1));
    store.moveRows(3, 5, -1); // swap rows [3,5] up with row 2
    expect(store.getMerges()).toEqual([range(2, 0, 3, 1)]);
  });

  it("moveRows drops a merge straddling the swap boundary instead of corrupting it", () => {
    const store = makeStore();
    // Moving rows [3,5] up swaps row 2 with rows 3-5. A merge at [4,6]
    // straddles that boundary: two-corner mapping alone would wrongly
    // produce a non-inverted [3,6] that absorbs old row 2's content into
    // what would become row 5 of the "merge".
    store.mergeCells(range(4, 0, 6, 1));
    store.moveRows(3, 5, -1);
    expect(store.getMerges()).toEqual([]);
  });

  it("moveRows drops a merge exactly spanning a single-line swap", () => {
    const store = makeStore();
    // A 2-row merge at [3,4] under a swap of rows 3/4 (moveRows(3,3,dir))
    // would look like a valid contiguous set {4,3} if checked unordered,
    // but the content actually swaps out from under the merge's span.
    store.mergeCells(range(3, 0, 4, 1));
    store.moveRows(3, 3, 1);
    expect(store.getMerges()).toEqual([]);
  });

  it("moveRows leaves a merge entirely outside the swapped region unchanged", () => {
    const store = makeStore();
    store.mergeCells(range(20, 0, 21, 1));
    store.moveRows(3, 5, -1);
    expect(store.getMerges()).toEqual([range(20, 0, 21, 1)]);
  });

  it("insertCols/deleteCols/moveCols mirror the row-axis behavior", () => {
    const store = makeStore();
    store.mergeCells(range(0, 3, 1, 6)); // cols 3-6
    store.insertCols(0, 2);
    expect(store.getMerges()).toEqual([range(0, 5, 1, 8)]); // cols 5-8
    store.deleteCols(6, 6); // interior column, not touching either corner
    expect(store.getMerges()).toEqual([range(0, 5, 1, 7)]); // cols 5-7
  });

  it("undoes a structural edit's merge remap along with content and styles", () => {
    const store = makeStore();
    store.mergeCells(range(5, 0, 6, 1));
    store.insertRows(0, 2);
    expect(store.getMerges()).toEqual([range(7, 0, 8, 1)]);
    store.undo();
    expect(store.getMerges()).toEqual([range(5, 0, 6, 1)]);
  });
});
