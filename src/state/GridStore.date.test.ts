// Tests for date/time literal entry on GridStore: auto-format on first
// entry (riding the same undo batch as the raw change), no auto-format
// over an existing numFmt, formula arithmetic on the stored serial, and
// sort/filter grouping treating equal serials as one value.

import { describe, expect, it } from "vitest";
import { GridStore } from "./GridStore";
import type { CellRange } from "../types";

const cell = (row: number, col: number): CellRange => ({
  startRow: row,
  startCol: col,
  endRow: row,
  endCol: col,
});

const makeStore = (rows = 100, cols = 26) => new GridStore(rows, cols, 100);

describe("date/time literal entry", () => {
  it("stores the serial, auto-applies Date, and keeps the raw text for re-editing", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "2008-09-26" }]);
    expect(store.getCell(0, 0)?.value).toBe(39717);
    expect(store.getStyle(0, 0)).toEqual({ numFmt: "date" });
    expect(store.getDisplay(0, 0)).toBe("9/26/2008");
    expect(store.getRaw(0, 0)).toBe("2008-09-26");
  });

  it("auto-applies Date time and Time for combined and bare-time literals", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "9/26/2008 15:59" },
      { row: 1, col: 0, raw: "3:59 PM" },
    ]);
    expect(store.getStyle(0, 0)).toEqual({ numFmt: "datetime" });
    expect(store.getDisplay(0, 0)).toBe("9/26/2008 15:59:00");
    expect(store.getStyle(1, 0)).toEqual({ numFmt: "time" });
    expect(store.getDisplay(1, 0)).toBe("3:59:00 PM");
  });

  it("does not parse invalid calendar/clock values or ambiguous numbers as dates", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "13/45/2026" },
      { row: 1, col: 0, raw: "25:99" },
      { row: 2, col: 0, raw: "1234.5" },
    ]);
    expect(store.getCell(0, 0)?.value).toBe("13/45/2026");
    expect(store.getStyle(0, 0)).toBeNull();
    expect(store.getCell(1, 0)?.value).toBe("25:99");
    expect(store.getStyle(1, 0)).toBeNull();
    expect(store.getCell(2, 0)?.value).toBe(1234.5);
    expect(store.getStyle(2, 0)).toBeNull();
  });

  it("stores the serial but keeps an existing explicit format", () => {
    const store = makeStore();
    store.applyStyle(cell(0, 0), { numFmt: "currency" });
    store.setCells([{ row: 0, col: 0, raw: "2008-09-26" }]);
    expect(store.getCell(0, 0)?.value).toBe(39717);
    expect(store.getStyle(0, 0)).toEqual({ numFmt: "currency" });
    expect(store.getDisplay(0, 0)).toBe("$39,717.00");
  });

  it("undoes the value and the auto-applied format in one step", () => {
    const store = makeStore();
    store.setCells([{ row: 0, col: 0, raw: "2008-09-26" }]);
    expect(store.getStyle(0, 0)).toEqual({ numFmt: "date" });
    store.undo();
    expect(store.getCell(0, 0)).toBeNull();
    expect(store.getStyle(0, 0)).toBeNull();
    store.redo();
    expect(store.getCell(0, 0)?.value).toBe(39717);
    expect(store.getStyle(0, 0)).toEqual({ numFmt: "date" });
  });

  it("participates in formula arithmetic as a plain number", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "2008-09-26" },
      { row: 1, col: 0, raw: "=A1+1" },
    ]);
    store.applyStyle(cell(1, 0), { numFmt: "date" });
    expect(store.getCell(1, 0)?.value).toBe(39718);
    expect(store.getDisplay(1, 0)).toBe("9/27/2008");
  });

  it("sorts date cells chronologically", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "2026-01-01" },
      { row: 1, col: 0, raw: "1999-12-31" },
      { row: 2, col: 0, raw: "2010-06-15" },
    ]);
    store.sortRange({ startRow: 0, startCol: 0, endRow: 2, endCol: 0 }, 0, "asc");
    expect(store.getRaw(0, 0)).toBe("1999-12-31");
    expect(store.getRaw(1, 0)).toBe("2010-06-15");
    expect(store.getRaw(2, 0)).toBe("2026-01-01");
  });

  it("groups equal serials from different date literal forms as one filter value", () => {
    const store = makeStore();
    store.setCells([
      { row: 0, col: 0, raw: "2008-09-26" },
      { row: 1, col: 0, raw: "9/26/2008" },
    ]);
    const values = store.getColumnValues(0);
    expect(values).toHaveLength(1);
    expect(values[0].count).toBe(2);
  });
});
