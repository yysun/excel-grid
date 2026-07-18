// Tests for the GridStore style layer: applyStyle merge/removal semantics,
// clearFormat, undo/redo integration with raw edits, number-format display
// (percent/thousands/decimals), and the style-cell cap.

import { describe, expect, it } from "vitest";
import { GridStore, STYLE_CELL_CAP } from "./GridStore";
import type { CellRange } from "../types";

const cell = (row: number, col: number): CellRange => ({
  startRow: row,
  startCol: col,
  endRow: row,
  endCol: col,
});

const range = (
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): CellRange => ({ startRow, startCol, endRow, endCol });

const makeStore = (rows = 100, cols = 26) => new GridStore(rows, cols, 100);

describe("applyStyle", () => {
  it("applies a style to every cell in the range", () => {
    const store = makeStore();
    store.applyStyle(range(0, 0, 1, 1), { bold: true });
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
    expect(store.getStyle(1, 1)).toEqual({ bold: true });
    expect(store.getStyle(2, 0)).toBeNull();
  });

  it("merges into existing styles and removes keys set to undefined", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    store.applyStyle(cell(0, 0), { color: "#e60000" });
    expect(store.getStyle(0, 0)).toEqual({ bold: true, color: "#e60000" });
    store.applyStyle(cell(0, 0), { color: undefined });
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
    store.applyStyle(cell(0, 0), { bold: undefined });
    expect(store.getStyle(0, 0)).toBeNull();
  });

  it("styles empty cells (fill color without a value)", () => {
    const store = makeStore();
    store.applyStyle(cell(5, 5), { background: "#fff2cc" });
    expect(store.getStyle(5, 5)).toEqual({ background: "#fff2cc" });
    expect(store.getDisplay(5, 5)).toBe("");
  });

  it("is a no-op above the style cell cap", () => {
    const store = new GridStore(1000, 1000, 100); // 1,000,000 > cap
    expect(1000 * 1000).toBeGreaterThan(STYLE_CELL_CAP);
    store.applyStyle(range(0, 0, 999, 999), { bold: true });
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.canUndo()).toBe(false);
  });

  it("does not record an undo step when nothing changes", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    store.applyStyle(cell(0, 0), { bold: true }); // identical
    store.undo();
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.canUndo()).toBe(false);
  });
});

describe("clearFormat", () => {
  it("removes all styling in the range as one undo step", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true, color: "#e60000" });
    store.applyStyle(cell(1, 0), { background: "#fff2cc" });
    store.clearFormat(range(0, 0, 5, 5));
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.getStyle(1, 0)).toBeNull();
    store.undo();
    expect(store.getStyle(0, 0)).toEqual({ bold: true, color: "#e60000" });
    expect(store.getStyle(1, 0)).toEqual({ background: "#fff2cc" });
  });

  it("leaves styles outside the range alone", () => {
    const store = makeStore();
    store.applyStyle(cell(9, 9), { bold: true });
    store.clearFormat(range(0, 0, 2, 2));
    expect(store.getStyle(9, 9)).toEqual({ bold: true });
  });
});

describe("undo/redo integration", () => {
  it("interleaves style and raw patches on one timeline", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    store.setCells([{ row: 1, col: 0, raw: "x" }]);
    store.applyStyle(cell(2, 0), { background: "#fff2cc" });

    store.undo(); // fill
    expect(store.getStyle(2, 0)).toBeNull();
    expect(store.getRaw(1, 0)).toBe("x");
    store.undo(); // raw edit
    expect(store.getRaw(1, 0)).toBe("");
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
    store.undo(); // bold
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.canUndo()).toBe(false);

    store.redo();
    store.redo();
    store.redo();
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
    expect(store.getRaw(1, 0)).toBe("x");
    expect(store.getStyle(2, 0)).toEqual({ background: "#fff2cc" });
    expect(store.canRedo()).toBe(false);
  });

  it("clears the redo stack on a new style action", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    store.undo();
    store.applyStyle(cell(0, 0), { italic: true });
    expect(store.canRedo()).toBe(false);
  });
});

describe("number formats in getDisplay", () => {
  it("formats percent with default and explicit decimals", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "0.5" }]);
    store.applyStyle(cell(0, 0), { numFmt: "percent" });
    expect(store.getDisplay(0, 0)).toBe("50%");
    store.applyStyle(cell(0, 0), { decimals: 2 });
    expect(store.getDisplay(0, 0)).toBe("50.00%");
  });

  it("formats thousands separators", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "1234567" }]);
    store.applyStyle(cell(0, 0), { numFmt: "thousands" });
    expect(store.getDisplay(0, 0)).toBe("1,234,567");
    store.applyStyle(cell(0, 0), { decimals: 2 });
    expect(store.getDisplay(0, 0)).toBe("1,234,567.00");
  });

  it("applies plain fixed decimals without a numFmt", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "4.666" }]);
    store.applyStyle(cell(0, 0), { decimals: 2 });
    expect(store.getDisplay(0, 0)).toBe("4.67");
  });

  it("formats formula results but never raw text or errors", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "1" },
      { row: 0, col: 1, raw: "3" },
      { row: 1, col: 0, raw: "=A1/B1" },
      { row: 2, col: 0, raw: "=1/0" },
      { row: 3, col: 0, raw: "hello" },
    ]);
    store.applyStyle(range(1, 0, 3, 0), { numFmt: "percent", decimals: 1 });
    expect(store.getDisplay(1, 0)).toBe("33.3%");
    expect(store.getDisplay(2, 0)).toBe("#DIV/0!");
    expect(store.getDisplay(3, 0)).toBe("hello");
    expect(store.getRaw(1, 0)).toBe("=A1/B1"); // raw untouched
  });
});
