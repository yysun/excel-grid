// Tests for the GridStore style layer: applyStyle merge/removal semantics,
// clearFormat, undo/redo integration with raw edits, number-format display
// (percent/thousands/decimals, number/currency/scientific, and
// date/time/datetime/duration serial rendering incl. negative fallback
// and the .00+/.0- no-op), the style-cell cap, the valign/wrap keys added
// for the toolbar vertical-alignment and wrap buttons, per-side border
// presets (applyBorder), format-painter's full-replace style commit
// (replaceStyle), font-family styling via applyStyle, and the format-
// painter's transient armed-source view state.

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

  it("merges valign and wrap with other keys and removes them via undefined", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    store.applyStyle(cell(0, 0), { valign: "top", wrap: true });
    expect(store.getStyle(0, 0)).toEqual({ bold: true, valign: "top", wrap: true });
    store.applyStyle(cell(0, 0), { valign: "bottom" });
    expect(store.getStyle(0, 0)).toEqual({ bold: true, valign: "bottom", wrap: true });
    store.applyStyle(cell(0, 0), { valign: undefined, wrap: undefined });
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
  });

  it("undoes and redoes valign/wrap changes", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { valign: "top" });
    store.applyStyle(cell(0, 0), { wrap: true });
    store.undo();
    expect(store.getStyle(0, 0)).toEqual({ valign: "top" });
    store.undo();
    expect(store.getStyle(0, 0)).toBeNull();
    store.redo();
    store.redo();
    expect(store.getStyle(0, 0)).toEqual({ valign: "top", wrap: true });
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

  it("removes valign and wrap", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { valign: "bottom", wrap: true });
    store.clearFormat(cell(0, 0));
    expect(store.getStyle(0, 0)).toBeNull();
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

  it("formats number with grouped 2-decimal default and decimals override", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "1234.5" }]);
    store.applyStyle(cell(0, 0), { numFmt: "number" });
    expect(store.getDisplay(0, 0)).toBe("1,234.50");
    store.applyStyle(cell(0, 0), { decimals: 0 });
    expect(store.getDisplay(0, 0)).toBe("1,235");
    store.applyStyle(cell(0, 0), { decimals: 3 });
    expect(store.getDisplay(0, 0)).toBe("1,234.500");
  });

  it("formats currency with the sign before the $", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "1234.5" },
      { row: 1, col: 0, raw: "-1234.5" },
    ]);
    store.applyStyle(range(0, 0, 1, 0), { numFmt: "currency" });
    expect(store.getDisplay(0, 0)).toBe("$1,234.50");
    expect(store.getDisplay(1, 0)).toBe("-$1,234.50");
    store.applyStyle(range(0, 0, 1, 0), { decimals: 0 });
    expect(store.getDisplay(0, 0)).toBe("$1,235");
    expect(store.getDisplay(1, 0)).toBe("-$1,235");
  });

  it("formats scientific with an uppercase exponent", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "1234.5" }]);
    store.applyStyle(cell(0, 0), { numFmt: "scientific" });
    expect(store.getDisplay(0, 0)).toBe("1.23E+3");
    store.applyStyle(cell(0, 0), { decimals: 4 });
    expect(store.getDisplay(0, 0)).toBe("1.2345E+3");
    store.setCells([{ row: 0, col: 0, raw: "0.00042" }]);
    store.applyStyle(cell(0, 0), { decimals: undefined });
    expect(store.getDisplay(0, 0)).toBe("4.20E-4");
  });

  it("leaves text cells unchanged when a new format is applied", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "hello" }]);
    store.applyStyle(cell(0, 0), { numFmt: "currency" });
    expect(store.getDisplay(0, 0)).toBe("hello");
  });

  it("removing numFmt and decimals restores plain display", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "1234.5" }]);
    store.applyStyle(cell(0, 0), { numFmt: "currency", decimals: 3 });
    expect(store.getDisplay(0, 0)).toBe("$1,234.500");
    store.applyStyle(cell(0, 0), { numFmt: undefined, decimals: undefined });
    expect(store.getDisplay(0, 0)).toBe("1234.5");
    expect(store.getStyle(0, 0)).toBeNull();
  });

  it("formats date, time, datetime, and duration serials", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "39717.66597" },
      { row: 1, col: 0, raw: "1.75" },
      { row: 2, col: 0, raw: "-1.5" },
    ]);
    store.applyStyle(cell(0, 0), { numFmt: "date" });
    expect(store.getDisplay(0, 0)).toBe("9/26/2008");
    store.applyStyle(cell(0, 0), { numFmt: "time" });
    expect(store.getDisplay(0, 0)).toBe("3:59:00 PM");
    store.applyStyle(cell(0, 0), { numFmt: "datetime" });
    expect(store.getDisplay(0, 0)).toBe("9/26/2008 15:59:00");
    store.applyStyle(cell(1, 0), { numFmt: "duration" });
    expect(store.getDisplay(1, 0)).toBe("42:00:00");
    store.applyStyle(cell(2, 0), { numFmt: "duration" });
    expect(store.getDisplay(2, 0)).toBe("-36:00:00");
  });

  it("falls back to plain rendering for a negative Date-formatted cell", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "-5" }]);
    store.applyStyle(cell(0, 0), { numFmt: "date" });
    expect(store.getDisplay(0, 0)).toBe("-5");
  });

  it(".00+ leaves date-format display unchanged", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "39717" }]);
    store.applyStyle(cell(0, 0), { numFmt: "date" });
    expect(store.getDisplay(0, 0)).toBe("9/26/2008");
    store.applyStyle(cell(0, 0), { decimals: 2 });
    expect(store.getDisplay(0, 0)).toBe("9/26/2008");
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

describe("font family", () => {
  it("applies and clears fontFamily like any other style key", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true, fontFamily: "Arial" });
    expect(store.getStyle(0, 0)).toEqual({ bold: true, fontFamily: "Arial" });
    store.applyStyle(cell(0, 0), { fontFamily: undefined });
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
  });
});

describe("applyBorder", () => {
  const thin = { style: "thin" as const, color: "#000000" };
  const thick = { style: "thick" as const, color: "#ff0000" };

  it("'all' sets every side on every cell in the range", () => {
    const store = makeStore();
    store.applyBorder(range(0, 0, 1, 1), "all", thin);
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      expect(store.getStyle(r, c)?.border).toEqual({
        top: thin, right: thin, bottom: thin, left: thin,
      });
    }
  });

  it("'outer' touches only the sides on the range boundary, leaving interior cells alone", () => {
    const store = makeStore();
    store.applyBorder(range(0, 0, 2, 2), "outer", thin);
    // Corner cell: top+left only (its right/bottom are interior-facing).
    expect(store.getStyle(0, 0)?.border).toEqual({ top: thin, left: thin });
    // Edge-midpoint cell: top only.
    expect(store.getStyle(0, 1)?.border).toEqual({ top: thin });
    // Center cell: fully interior, untouched (no style record at all).
    expect(store.getStyle(1, 1)).toBeNull();
    // Bottom-right corner: bottom+right.
    expect(store.getStyle(2, 2)?.border).toEqual({ bottom: thin, right: thin });
  });

  it("a single edge preset only touches that edge's cells and only that side", () => {
    const store = makeStore();
    store.applyBorder(range(0, 0, 2, 2), "top", thin);
    expect(store.getStyle(0, 0)?.border).toEqual({ top: thin });
    expect(store.getStyle(0, 1)?.border).toEqual({ top: thin });
    expect(store.getStyle(1, 0)).toBeNull();
    expect(store.getStyle(2, 0)).toBeNull();
  });

  it("leaves other sides of a cell untouched when applying a different edge", () => {
    const store = makeStore();
    store.applyBorder(cell(0, 0), "top", thin);
    store.applyBorder(cell(0, 0), "left", thick);
    expect(store.getStyle(0, 0)?.border).toEqual({ top: thin, left: thick });
  });

  it("'none' clears the border entirely regardless of cell position", () => {
    const store = makeStore();
    store.applyBorder(range(0, 0, 1, 1), "all", thin);
    store.applyBorder(range(0, 0, 1, 1), "none", null);
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      expect(store.getStyle(r, c)?.border).toBeUndefined();
    }
  });

  it("'none' preserves other style keys on the cell", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    store.applyBorder(cell(0, 0), "all", thin);
    store.applyBorder(cell(0, 0), "none", null);
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
  });

  it("undoes and redoes as one action", () => {
    const store = makeStore();
    store.applyBorder(range(0, 0, 1, 1), "all", thin);
    expect(store.getStyle(0, 0)?.border).toBeDefined();
    store.undo();
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.getStyle(1, 1)).toBeNull();
    store.redo();
    expect(store.getStyle(0, 0)?.border).toEqual({
      top: thin, right: thin, bottom: thin, left: thin,
    });
  });

  it("is a no-op above the style cell cap", () => {
    const store = new GridStore(1000, 1000, 100);
    store.applyBorder(range(0, 0, 999, 999), "all", thin);
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.canUndo()).toBe(false);
  });

  it("does not record an undo step when re-applying an identical border", () => {
    const store = makeStore();
    store.applyBorder(range(0, 0, 1, 1), "all", thin);
    store.applyBorder(range(0, 0, 1, 1), "all", { style: "thin", color: "#000000" });
    store.undo();
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.canUndo()).toBe(false);
  });
});

describe("replaceStyle", () => {
  it("overwrites the destination's style outright, clearing omitted keys", () => {
    const store = makeStore();
    store.applyStyle(cell(1, 1), { italic: true, color: "#e60000" });
    store.replaceStyle(cell(1, 1), { bold: true });
    expect(store.getStyle(1, 1)).toEqual({ bold: true });
  });

  it("applies the same style to every cell in the destination range", () => {
    const store = makeStore();
    store.replaceStyle(range(0, 0, 1, 1), { bold: true, fontFamily: "Georgia" });
    expect(store.getStyle(0, 0)).toEqual({ bold: true, fontFamily: "Georgia" });
    expect(store.getStyle(1, 1)).toEqual({ bold: true, fontFamily: "Georgia" });
  });

  it("clears style with a null replacement", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    store.replaceStyle(cell(0, 0), null);
    expect(store.getStyle(0, 0)).toBeNull();
  });

  it("undoes and redoes as one action", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { italic: true });
    store.replaceStyle(cell(0, 0), { bold: true });
    store.undo();
    expect(store.getStyle(0, 0)).toEqual({ italic: true });
    store.redo();
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
  });
});

describe("format-painter armed state", () => {
  it("arms with a copy of the source range and reports armed", () => {
    const store = makeStore();
    expect(store.isFormatPainterArmed()).toBe(false);
    store.armFormatPainter(range(0, 0, 1, 1));
    expect(store.isFormatPainterArmed()).toBe(true);
    expect(store.getFormatPainterSource()).toEqual(range(0, 0, 1, 1));
  });

  it("disarms and reports unarmed", () => {
    const store = makeStore();
    store.armFormatPainter(cell(0, 0));
    store.disarmFormatPainter();
    expect(store.isFormatPainterArmed()).toBe(false);
    expect(store.getFormatPainterSource()).toBeNull();
  });

  it("is not undoable and does not push an undo entry", () => {
    const store = makeStore();
    store.armFormatPainter(cell(0, 0));
    store.disarmFormatPainter();
    expect(store.canUndo()).toBe(false);
  });
});
