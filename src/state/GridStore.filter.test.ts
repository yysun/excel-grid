// Unit tests for the GridStore per-column value-set filter model:
// filter-mode toggling (setFilterCols/clearFilterCols), setColFilter AND
// semantics, blank handling, getColumnValues ordering/counts, derived
// re-evaluation on edits, select-all commits, structural remap + undo, and
// clearColFilters.

import { describe, expect, it } from "vitest";
import { GridStore, filterValueKey } from "./GridStore";

const make = (rows = 10, cols = 6) => new GridStore(rows, cols, 100);

/** Column 0: Apple, Banana, Apple, Cherry, (blank r4 within used range via col 1). */
const seed = (s: GridStore) => {
  s.setCells([
    { row: 0, col: 0, raw: "Apple" },
    { row: 1, col: 0, raw: "Banana" },
    { row: 2, col: 0, raw: "Apple" },
    { row: 3, col: 0, raw: "Cherry" },
    { row: 0, col: 1, raw: "1" },
    { row: 1, col: 1, raw: "2" },
    { row: 2, col: 1, raw: "1" },
    { row: 3, col: 1, raw: "3" },
    { row: 4, col: 1, raw: "4" }, // row 4 has a blank in col 0
  ]);
};

describe("filterValueKey", () => {
  it("canonicalizes blank, boolean, number, text", () => {
    expect(filterValueKey(null)).toBe("");
    expect(filterValueKey(true)).toBe("TRUE");
    expect(filterValueKey(false)).toBe("FALSE");
    expect(filterValueKey(42)).toBe("42");
    expect(filterValueKey("x")).toBe("x");
  });
});

describe("filter mode (setFilterCols / clearFilterCols)", () => {
  it("tracks filter-button columns and drives hasFilter", () => {
    const s = make();
    expect(s.hasFilter()).toBe(false);
    s.setFilterCols([1, 2]);
    expect(s.hasFilter()).toBe(true);
    expect(s.isFilterCol(1)).toBe(true);
    expect(s.isFilterCol(0)).toBe(false);
    expect([...s.getFilterCols()].sort()).toEqual([1, 2]);
    s.clearFilterCols();
    expect(s.hasFilter()).toBe(false);
    expect(s.isFilterCol(1)).toBe(false);
  });

  it("clearFilterCols removes filters and unhides rows", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    expect(s.isRowHidden(1)).toBe(true);
    s.clearFilterCols();
    expect(s.isRowHidden(1)).toBe(false);
    expect(s.hasActiveFilters()).toBe(false);
  });

  it("replacing filter cols drops filters on removed columns", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    s.setFilterCols([1]); // col 0 no longer a filter column
    expect(s.hasActiveColFilter(0)).toBe(false);
    expect(s.isRowHidden(1)).toBe(false);
  });

  it("ignores out-of-range columns", () => {
    const s = make(10, 3);
    s.setFilterCols([-1, 1, 99]);
    expect([...s.getFilterCols()]).toEqual([1]);
  });
});

describe("setColFilter", () => {
  it("hides used-range rows whose value is not allowed", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isRowHidden(1)).toBe(true); // Banana
    expect(s.isRowHidden(2)).toBe(false);
    expect(s.isRowHidden(3)).toBe(true); // Cherry
    expect(s.isRowHidden(4)).toBe(true); // blank
    expect(s.hasActiveColFilter(0)).toBe(true);
    expect(s.isFilterCol(0)).toBe(true); // auto-enabled button
  });

  it("blank key '' matches blank cells", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple", ""]));
    expect(s.isRowHidden(4)).toBe(false); // blank allowed
    expect(s.isRowHidden(1)).toBe(true);
  });

  it("combines filters on two columns with AND", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    s.setColFilter(1, new Set(["1"]));
    expect(s.isRowHidden(0)).toBe(false); // Apple + 1
    expect(s.isRowHidden(2)).toBe(false); // Apple + 1
    expect(s.isRowHidden(1)).toBe(true);
    expect(s.isRowHidden(3)).toBe(true);
    s.setColFilter(1, null); // clear col 1 only
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isRowHidden(1)).toBe(true); // col 0 filter still active
  });

  it("null (select all) clears the column's filter and restores rows", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    expect(s.isRowHidden(1)).toBe(true);
    s.setColFilter(0, null);
    expect(s.hasActiveColFilter(0)).toBe(false);
    expect(s.isFilterCol(0)).toBe(true);
    expect(s.isRowHidden(1)).toBe(false);
  });

  it("getColFilter returns a defensive copy", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    const copy = s.getColFilter(0)!;
    copy.add("Banana");
    expect(s.isRowHidden(1)).toBe(true); // internal set unchanged
  });

  it("re-evaluates visibility when a filtered cell is edited", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    expect(s.isRowHidden(1)).toBe(true);
    s.setCells([{ row: 1, col: 0, raw: "Apple" }]);
    expect(s.isRowHidden(1)).toBe(false);
    s.setCells([{ row: 0, col: 0, raw: "Durian" }]);
    expect(s.isRowHidden(0)).toBe(true);
  });

  it("compares by computed value: formulas filter by their result", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "2" },
      { row: 1, col: 0, raw: "=1+1" },
      { row: 2, col: 0, raw: "3" },
    ]);
    s.setColFilter(0, new Set(["2"]));
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isRowHidden(1)).toBe(false); // =1+1 → 2
    expect(s.isRowHidden(2)).toBe(true);
  });
});

describe("getColumnValues", () => {
  it("returns distinct values sorted asc with counts, blanks last", () => {
    const s = make();
    seed(s);
    expect(s.getColumnValues(0)).toEqual([
      { key: "Apple", label: "Apple", count: 2 },
      { key: "Banana", label: "Banana", count: 1 },
      { key: "Cherry", label: "Cherry", count: 1 },
      { key: "", label: "", count: 1 },
    ]);
  });

  it("sorts numbers before text", () => {
    const s = make();
    s.setCells([
      { row: 0, col: 0, raw: "beta" },
      { row: 1, col: 0, raw: "10" },
      { row: 2, col: 0, raw: "2" },
    ]);
    expect(s.getColumnValues(0).map((v) => v.key)).toEqual(["2", "10", "beta"]);
  });

  it("returns [] for an empty sheet", () => {
    expect(make().getColumnValues(0)).toEqual([]);
  });
});

describe("structural edits", () => {
  it("remaps filter buttons and filters on column insert/delete", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    s.insertCols(0, 1);
    expect(s.isFilterCol(0)).toBe(false);
    expect(s.isFilterCol(1)).toBe(true);
    expect(s.hasActiveColFilter(1)).toBe(true);
    expect(s.isRowHidden(1)).toBe(true); // still filtering the moved column
    s.deleteCols(1, 1); // delete the filtered column
    expect(s.hasFilter()).toBe(false);
    expect(s.isRowHidden(1)).toBe(false);
  });

  it("structural undo restores filter state to pre-edit columns", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    s.insertCols(0, 1);
    expect(s.hasActiveColFilter(1)).toBe(true);
    s.undo();
    expect(s.hasActiveColFilter(0)).toBe(true);
    expect(s.isFilterCol(1)).toBe(false);
    expect(s.isRowHidden(1)).toBe(true); // Banana still filtered out
    s.redo();
    expect(s.hasActiveColFilter(1)).toBe(true);
  });

  it("keeps filters correct after row insertion above filtered rows", () => {
    const s = make();
    seed(s);
    s.setColFilter(0, new Set(["Apple"]));
    s.insertRows(0, 1);
    // The inserted blank row sits above the used range, so it is not
    // subject to filtering.
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isRowHidden(1)).toBe(false); // Apple shifted down
    expect(s.isRowHidden(2)).toBe(true); // Banana shifted down
  });
});
