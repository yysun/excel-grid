// Unit tests for GridStore: literal parsing, formula recalculation through
// the dependency graph (direct + range deps), cycle detection, error
// propagation, undo/redo batches, clearRange, and onChange payloads.

import { describe, expect, it } from "vitest";
import type { GridChange } from "../types";
import { GridStore } from "./GridStore";

const make = () => new GridStore(100, 26, 100);

describe("literals", () => {
  it("parses numbers, booleans, and text", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "42" },
      { row: 1, col: 0, raw: "4.5" },
      { row: 2, col: 0, raw: "true" },
      { row: 3, col: 0, raw: "hello" },
    ]);
    expect(s.getCell(0, 0)?.value).toBe(42);
    expect(s.getCell(1, 0)?.value).toBe(4.5);
    expect(s.getCell(2, 0)?.value).toBe(true);
    expect(s.getCell(3, 0)?.value).toBe("hello");
    expect(s.getDisplay(2, 0)).toBe("TRUE");
  });
});

describe("formulas and recalculation", () => {
  it("computes on entry and recomputes dependents on change", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "1" }, // A1
      { row: 1, col: 0, raw: "2" }, // A2
      { row: 2, col: 0, raw: "3" }, // A3
      { row: 4, col: 0, raw: "=SUM(A1:A3)" }, // A5
      { row: 4, col: 1, raw: "=A5*2" }, // B5
    ]);
    expect(s.getCell(4, 0)?.value).toBe(6);
    expect(s.getCell(4, 1)?.value).toBe(12);
    s.setCells([{ row: 1, col: 0, raw: "10" }]);
    expect(s.getCell(4, 0)?.value).toBe(14);
    expect(s.getCell(4, 1)?.value).toBe(28); // transitive recalc
  });

  it("recomputes when a referenced cell is cleared", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "5" },
      { row: 0, col: 1, raw: "=A1+1" },
    ]);
    expect(s.getCell(0, 1)?.value).toBe(6);
    s.setCells([{ row: 0, col: 0, raw: null }]);
    expect(s.getCell(0, 1)?.value).toBe(1);
  });

  it("detects self-reference cycles", () => {
    const s = make();
    s.setCells([{ row: 2, col: 2, raw: "=C3" }]);
    expect(s.getCell(2, 2)?.error).toBe("#CYCLE!");
    expect(s.getDisplay(2, 2)).toBe("#CYCLE!");
  });

  it("detects mutual cycles and recovers when broken", () => {
    const s = make();
    s.setCells([{ row: 0, col: 0, raw: "=B1" }]);
    s.setCells([{ row: 0, col: 1, raw: "=A1" }]);
    expect(s.getCell(0, 0)?.error).toBe("#CYCLE!");
    expect(s.getCell(0, 1)?.error).toBe("#CYCLE!");
    s.setCells([{ row: 0, col: 1, raw: "7" }]);
    expect(s.getCell(0, 0)?.value).toBe(7);
    expect(s.getCell(0, 0)?.error).toBeUndefined();
  });

  it("propagates errors from referenced cells", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "=1/0" },
      { row: 0, col: 1, raw: "=A1+1" },
    ]);
    expect(s.getDisplay(0, 0)).toBe("#DIV/0!");
    expect(s.getDisplay(0, 1)).toBe("#DIV/0!");
  });

  it("shows #NAME? for unknown functions and #REF! for #REF! formulas", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "=NOSUCHFN(1)" },
      { row: 0, col: 1, raw: "=#REF!+1" },
    ]);
    expect(s.getDisplay(0, 0)).toBe("#NAME?");
    expect(s.getDisplay(0, 1)).toBe("#REF!");
  });

  it("out-of-bounds references error with #REF!", () => {
    const s = new GridStore(10, 5, 100);
    s.setCells([{ row: 0, col: 0, raw: "=Z99" }]);
    expect(s.getDisplay(0, 0)).toBe("#REF!");
  });
});

describe("undo / redo", () => {
  it("reverts and reapplies a single edit with recalculation", () => {
    const s = make();
    s.setCells([{ row: 0, col: 0, raw: "1" }]);
    s.setCells([{ row: 0, col: 1, raw: "=A1*10" }]);
    s.setCells([{ row: 0, col: 0, raw: "2" }]);
    expect(s.getCell(0, 1)?.value).toBe(20);
    s.undo();
    expect(s.getCell(0, 0)?.value).toBe(1);
    expect(s.getCell(0, 1)?.value).toBe(10);
    s.redo();
    expect(s.getCell(0, 0)?.value).toBe(2);
    expect(s.getCell(0, 1)?.value).toBe(20);
  });

  it("treats a batch as one undo step and clears redo on new edits", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "a" },
      { row: 0, col: 1, raw: "b" },
      { row: 0, col: 2, raw: "c" },
    ]);
    s.undo();
    expect(s.getCell(0, 0)).toBeNull();
    expect(s.getCell(0, 1)).toBeNull();
    expect(s.getCell(0, 2)).toBeNull();
    s.redo();
    expect(s.getCell(0, 2)?.value).toBe("c");
    s.setCells([{ row: 5, col: 5, raw: "x" }]);
    expect(s.canRedo()).toBe(false);
  });

  it("unrecorded batches (initial data) are not undoable", () => {
    const s = make();
    s.setCells([{ row: 0, col: 0, raw: "seed" }], false);
    expect(s.canUndo()).toBe(false);
  });
});

describe("clearRange and onChange", () => {
  it("clears only occupied cells and reports changes", () => {
    const s = make();
    const events: GridChange[][] = [];
    s.onChange = (c) => events.push(c);
    s.setCells([
      { row: 0, col: 0, raw: "1" },
      { row: 1, col: 1, raw: "2" },
    ]);
    s.clearRange({ startRow: 0, endRow: 2, startCol: 0, endCol: 2 });
    expect(s.getCell(0, 0)).toBeNull();
    expect(s.getCell(1, 1)).toBeNull();
    const last = events.at(-1)!;
    expect(last).toHaveLength(2);
    expect(last.map((c) => c.ref).sort()).toEqual(["A1", "B2"]);
    expect(last[0].raw).toBeNull();
  });

  it("onChange includes recomputed dependent cells", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "1" },
      { row: 0, col: 1, raw: "=A1+1" },
    ]);
    const events: GridChange[][] = [];
    s.onChange = (c) => events.push(c);
    s.setCells([{ row: 0, col: 0, raw: "5" }]);
    const refs = events.at(-1)!.map((c) => c.ref).sort();
    expect(refs).toEqual(["A1", "B1"]);
  });
});

describe("column widths", () => {
  it("stores widths with a minimum and returns the default otherwise", () => {
    const s = make();
    expect(s.getColWidth(3)).toBe(100);
    s.setColWidth(3, 150);
    expect(s.getColWidth(3)).toBe(150);
    s.setColWidth(3, 5);
    expect(s.getColWidth(3)).toBe(30);
  });
});
