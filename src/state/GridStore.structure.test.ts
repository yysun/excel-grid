// Unit tests for GridStore structural operations: insert/delete/move of
// rows and columns (content, styles, colWidths, formula rewriting, overflow
// drop, single-action undo/redo), hide/filter/freeze view state, sortRange
// ordering, and getUsedRange.

import { describe, expect, it } from "vitest";
import { GridStore, compareCellValues } from "./GridStore";

const make = (rows = 10, cols = 6) => new GridStore(rows, cols, 100);

/** Seed: A1=10, A2=2, A3==A1+A2, B1..B3 fruit. */
const seed = (s: GridStore) => {
  s.setCells([
    { row: 0, col: 0, raw: "10" },
    { row: 1, col: 0, raw: "2" },
    { row: 2, col: 0, raw: "=A1+A2" },
    { row: 0, col: 1, raw: "banana" },
    { row: 1, col: 1, raw: "apple" },
    { row: 2, col: 1, raw: "Cherry" },
  ]);
};

describe("insertRows", () => {
  it("shifts content and styles down and rewrites references", () => {
    const s = make();
    seed(s);
    s.applyStyle(
      { startRow: 1, startCol: 0, endRow: 1, endCol: 0 },
      { bold: true }
    );
    s.insertRows(1, 1);
    expect(s.getCell(1, 0)).toBeNull(); // new empty row
    expect(s.getCell(2, 0)?.value).toBe(2); // shifted
    expect(s.getStyle(2, 0)?.bold).toBe(true); // style moved with it
    expect(s.getRaw(3, 0)).toBe("=A1+A3"); // ref followed the shift
    expect(s.getCell(3, 0)?.value).toBe(12);
  });

  it("drops content pushed past the last row", () => {
    const s = make(3, 3);
    s.setCells([{ row: 2, col: 0, raw: "edge" }]);
    s.insertRows(0, 1);
    expect(s.getCell(2, 0)).toBeNull(); // fell off the sheet
    expect(s.getUsedRange()).toBeNull();
  });
});

describe("deleteRows", () => {
  it("shifts content back and #REF!s references to deleted rows", () => {
    const s = make();
    seed(s);
    s.deleteRows(0, 0); // delete row 1 (A1)
    expect(s.getCell(0, 0)?.value).toBe(2); // old A2
    expect(s.getRaw(1, 0)).toBe("=#REF!+A1");
    expect(s.getCell(1, 0)?.error).toBe("#REF!");
    expect(s.getCell(1, 1)?.value).toBe("Cherry");
  });

  it("undoes and redoes as a single action restoring the exact sheet", () => {
    const s = make();
    seed(s);
    s.applyStyle(
      { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      { italic: true }
    );
    s.deleteRows(0, 0);
    s.undo(); // one undo reverts the whole structural edit
    expect(s.getCell(0, 0)?.value).toBe(10);
    expect(s.getStyle(0, 0)?.italic).toBe(true);
    expect(s.getRaw(2, 0)).toBe("=A1+A2");
    expect(s.getCell(2, 0)?.value).toBe(12);
    s.redo();
    expect(s.getCell(0, 0)?.value).toBe(2);
    expect(s.getCell(1, 0)?.error).toBe("#REF!");
  });
});

describe("insert/delete columns", () => {
  it("shifts content and column widths and rewrites references", () => {
    const s = make();
    seed(s);
    s.setColWidth(1, 150);
    s.insertCols(1, 1);
    expect(s.getCell(0, 1)).toBeNull();
    expect(s.getCell(0, 2)?.value).toBe("banana");
    expect(s.getColWidth(2)).toBe(150); // width moved with the column
    expect(s.getColWidth(1)).toBe(100); // inserted column gets default
    expect(s.getRaw(2, 0)).toBe("=A1+A2"); // A-refs unaffected
    s.undo();
    expect(s.getCell(0, 1)?.value).toBe("banana");
    expect(s.getColWidth(1)).toBe(150);
  });

  it("deleteCols #REF!s references into the deleted column", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 1, raw: "7" },
      { row: 0, col: 2, raw: "=B1*2" },
    ]);
    s.deleteCols(1, 1);
    expect(s.getRaw(0, 1)).toBe("=#REF!*2");
    expect(s.getCell(0, 1)?.error).toBe("#REF!");
  });
});

describe("move", () => {
  it("moveRows swaps the block with the adjacent row; refs follow", () => {
    const s = make();
    seed(s);
    s.moveRows(0, 1, 1); // rows 1-2 down: row 3 -> row 1
    expect(s.getRaw(0, 0)).toBe("=A2+A3"); // formula moved to row 1, refs follow
    expect(s.getCell(0, 0)?.value).toBe(12);
    expect(s.getCell(1, 0)?.value).toBe(10);
    expect(s.getCell(2, 0)?.value).toBe(2);
    s.undo();
    expect(s.getRaw(2, 0)).toBe("=A1+A2");
    expect(s.getCell(2, 0)?.value).toBe(12);
  });

  it("moveCols moves content and is a no-op at the sheet edge", () => {
    const s = make();
    seed(s);
    s.moveCols(1, 1, -1); // fruit column left
    expect(s.getCell(0, 0)?.value).toBe("banana");
    expect(s.getCell(0, 1)?.value).toBe(10);
    expect(s.getRaw(2, 1)).toBe("=B1+B2");
    expect(s.getCell(2, 1)?.value).toBe(12);
    expect(s.canUndo()).toBe(true);
    s.moveCols(0, 0, -1); // at edge: no-op, no undo entry
    expect(s.getCell(0, 0)?.value).toBe("banana");
    s.undo();
    expect(s.getCell(0, 0)?.value).toBe(10); // the move undone, not the no-op
  });
});

describe("hide, filter, freeze", () => {
  it("tracks hidden rows/cols and detects them in ranges", () => {
    const s = make();
    s.setRowsHidden(1, 2, true);
    expect(s.isRowHidden(1)).toBe(true);
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.hasHiddenRowsIn(0, 3)).toBe(true);
    s.setRowsHidden(0, 3, false);
    expect(s.hasHiddenRowsIn(0, 9)).toBe(false);
    s.setColsHidden(2, 2, true);
    expect(s.isColHidden(2)).toBe(true);
    expect(s.hasHiddenColsIn(0, 5)).toBe(true);
  });

  it("hidden flags are remapped by structural edits", () => {
    const s = make();
    s.setRowsHidden(2, 2, true);
    s.insertRows(0, 1);
    expect(s.isRowHidden(3)).toBe(true);
    expect(s.isRowHidden(2)).toBe(false);
    s.undo(); // structural undo restores the pre-edit hidden set
    expect(s.isRowHidden(2)).toBe(true);
  });

  it("filterByValue hides non-matching used-range rows; manual unhide keeps them", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 2, raw: "x" },
      { row: 1, col: 2, raw: "y" },
      { row: 2, col: 2, raw: "x" },
    ]);
    s.filterByValue(2, 0);
    expect(s.hasFilter()).toBe(true);
    expect(s.isRowHidden(1)).toBe(true);
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isRowHidden(2)).toBe(false);
    s.setRowsHidden(1, 1, false); // manual unhide does not clear the filter
    expect(s.isRowHidden(1)).toBe(true);
    s.clearFilter();
    expect(s.hasFilter()).toBe(false);
    expect(s.isRowHidden(1)).toBe(false);
  });

  it("clamps frozen counts", () => {
    const s = make(10, 6);
    s.setFrozenRows(3);
    s.setFrozenCols(2);
    expect(s.getFrozenRows()).toBe(3);
    expect(s.getFrozenCols()).toBe(2);
    s.setFrozenRows(99);
    expect(s.getFrozenRows()).toBe(9);
    s.setFrozenRows(0);
    expect(s.getFrozenRows()).toBe(0);
  });
});

describe("sortRange", () => {
  it("sorts numbers before text, case-insensitively, blanks last", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "banana" },
      { row: 1, col: 0, raw: "3" },
      // row 2 blank
      { row: 3, col: 0, raw: "Apple" },
      { row: 4, col: 0, raw: "1" },
    ]);
    s.sortRange({ startRow: 0, startCol: 0, endRow: 4, endCol: 0 }, 0, "asc");
    expect(s.getCell(0, 0)?.value).toBe(1);
    expect(s.getCell(1, 0)?.value).toBe(3);
    expect(s.getCell(2, 0)?.value).toBe("Apple");
    expect(s.getCell(3, 0)?.value).toBe("banana");
    expect(s.getCell(4, 0)).toBeNull(); // blank stays last
  });

  it("descending reverses non-blanks but keeps blanks last; undo is one step", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "1" },
      { row: 1, col: 0, raw: "b" },
      { row: 2, col: 0, raw: "a" },
    ]);
    s.sortRange({ startRow: 0, startCol: 0, endRow: 3, endCol: 0 }, 0, "desc");
    expect(s.getCell(0, 0)?.value).toBe("b");
    expect(s.getCell(1, 0)?.value).toBe("a");
    expect(s.getCell(2, 0)?.value).toBe(1);
    expect(s.getCell(3, 0)).toBeNull();
    s.undo();
    expect(s.getCell(0, 0)?.value).toBe(1);
    expect(s.getCell(1, 0)?.value).toBe("b");
  });

  it("moves whole rows within the range keyed on the key column", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "2" },
      { row: 0, col: 1, raw: "two" },
      { row: 1, col: 0, raw: "1" },
      { row: 1, col: 1, raw: "one" },
    ]);
    s.sortRange({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, 0, "asc");
    expect(s.getCell(0, 0)?.value).toBe(1);
    expect(s.getCell(0, 1)?.value).toBe("one");
    expect(s.getCell(1, 0)?.value).toBe(2);
    expect(s.getCell(1, 1)?.value).toBe("two");
  });
});

describe("compareCellValues", () => {
  it("orders numbers < text < blanks and respects direction", () => {
    expect(compareCellValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareCellValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareCellValues(9, "a", "asc")).toBeLessThan(0);
    expect(compareCellValues("a", "B", "asc")).toBeLessThan(0);
    expect(compareCellValues(null, 1, "asc")).toBeGreaterThan(0);
    expect(compareCellValues(null, 1, "desc")).toBeGreaterThan(0); // blanks last both ways
  });
});

describe("getUsedRange", () => {
  it("returns the bounding box of occupied cells or null", () => {
    const s = make();
    expect(s.getUsedRange()).toBeNull();
    s.setCells([
      { row: 2, col: 1, raw: "a" },
      { row: 5, col: 3, raw: "b" },
    ]);
    expect(s.getUsedRange()).toEqual({
      startRow: 2,
      endRow: 5,
      startCol: 1,
      endCol: 3,
    });
  });
});
