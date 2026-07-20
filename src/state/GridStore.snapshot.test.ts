// Tests for the GridStore persistence surface: getSnapshot (cells +
// styles + colWidths), initStyle's not-undoable/no-notify contract,
// subscribe firing on style-only and width-only edits (the onStateChange
// prop's backing behavior), and the format-aware display field on
// getAllCells entries.

import { describe, expect, it, vi } from "vitest";
import { GridStore } from "./GridStore";
import type { CellRange } from "../types";

const cell = (row: number, col: number): CellRange => ({
  startRow: row,
  startCol: col,
  endRow: row,
  endCol: col,
});

const makeStore = (rows = 100, cols = 26) => new GridStore(rows, cols, 100);

describe("getSnapshot", () => {
  it("captures cells, styles, and column widths keyed for JSON", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "hello" },
      { row: 1, col: 1, raw: "=1+2" },
    ]);
    store.applyStyle(cell(0, 0), { bold: true, numFmt: "currency" });
    store.setColWidth(0, 150);

    expect(store.getSnapshot()).toEqual({
      cells: { A1: "hello", B2: "=1+2" },
      styles: { A1: { bold: true, numFmt: "currency" } },
      colWidths: { 0: 150 },
    });
  });

  it("is empty for a fresh store and JSON round-trips", () => {
    const store = makeStore();
    expect(store.getSnapshot()).toEqual({ cells: {}, styles: {}, colWidths: {} });

    store.setCells([{ row: 2, col: 3, raw: "x" }]);
    store.applyStyle(cell(2, 3), { italic: true });
    const roundTripped = JSON.parse(JSON.stringify(store.getSnapshot()));
    expect(roundTripped).toEqual(store.getSnapshot());
  });

  it("returns copies that do not alias live style records", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { bold: true });
    const snap = store.getSnapshot();
    snap.styles.A1.bold = false;
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
  });
});

describe("initStyle", () => {
  it("sets the style without creating an undo entry", () => {
    const store = makeStore();
    store.initStyle(0, 0, { bold: true });
    expect(store.getStyle(0, 0)).toEqual({ bold: true });
    expect(store.getSnapshot().styles.A1).toEqual({ bold: true });
    expect(store.canUndo()).toBe(false);
  });

  it("does not notify subscribers", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.initStyle(0, 0, { italic: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores out-of-bounds coordinates", () => {
    const store = makeStore(10, 5);
    store.initStyle(10, 0, { bold: true });
    store.initStyle(0, 5, { bold: true });
    expect(store.getSnapshot().styles).toEqual({});
  });
});

describe("subscribe (onStateChange contract)", () => {
  it("fires on a style-only edit", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyStyle(cell(0, 0), { bold: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires on a width-only edit", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setColWidth(2, 180);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("getAllCells display", () => {
  it("applies number formats and renders booleans/errors like the grid", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "1234.5" },
      { row: 1, col: 0, raw: "true" },
      { row: 2, col: 0, raw: "=1/0" },
    ]);
    store.applyStyle(cell(0, 0), { numFmt: "currency" });

    const byRef = new Map(
      store.getAllCells().map((c) => [`${c.row},${c.col}`, c.display])
    );
    expect(byRef.get("0,0")).toBe("$1,234.50");
    expect(byRef.get("1,0")).toBe("TRUE");
    expect(byRef.get("2,0")).toBe("#DIV/0!");
  });
});
