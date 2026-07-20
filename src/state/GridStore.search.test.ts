// Unit tests for GridStore's live text search: setSearchQuery/setSearchCols,
// isCellMatched, and how searchHiddenRows folds into isRowHidden alongside
// manual hides and column filters. There is no "search everything" mode:
// setSearchCols always pins matching to exactly the given columns, mirroring
// how Toolbar pushes the grid's current selection.

import { describe, expect, it } from "vitest";
import { GridStore } from "./GridStore";

const make = (rows = 10, cols = 6) => new GridStore(rows, cols, 100);

/** Column 0: Apple, Banana, Apple, Cherry. Column 1: notes text. */
const seed = (s: GridStore) => {
  s.setCells([
    { row: 0, col: 0, raw: "Apple" },
    { row: 1, col: 0, raw: "Banana" },
    { row: 2, col: 0, raw: "Apple" },
    { row: 3, col: 0, raw: "Cherry" },
    { row: 0, col: 1, raw: "fresh" },
    { row: 1, col: 1, raw: "ripe" },
    { row: 2, col: 1, raw: "old" },
    { row: 3, col: 1, raw: "banana split" },
  ]);
};

describe("setSearchQuery / row hiding", () => {
  it("hides rows with no case-insensitive match, leaves matches visible", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setSearchQuery("an");
    // "Banana" (row1) and "banana split" (row3, via col1) match.
    expect(s.isRowHidden(0)).toBe(true); // Apple / fresh
    expect(s.isRowHidden(1)).toBe(false); // Banana
    expect(s.isRowHidden(2)).toBe(true); // Apple / old
    expect(s.isRowHidden(3)).toBe(false); // banana split
  });

  it("is case-insensitive", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setSearchQuery("APPLE");
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isRowHidden(2)).toBe(false);
    expect(s.isRowHidden(1)).toBe(true);
  });

  it("matches the formatted display, not the raw value", () => {
    const s = make();
    s.setCells([{ row: 0, col: 0, raw: "0.5" }]);
    s.applyStyle(
      { startRow: 0, endRow: 0, startCol: 0, endCol: 0 },
      { numFmt: "percent", decimals: 0 }
    );
    expect(s.getDisplay(0, 0)).toBe("50%");
    s.setSearchCols([0]);
    s.setSearchQuery("50%");
    expect(s.isRowHidden(0)).toBe(false);
    s.setSearchQuery("0.5");
    expect(s.isRowHidden(0)).toBe(true); // raw text no longer shown
  });

  it("blank query clears hiding and matches", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setSearchQuery("an");
    expect(s.isRowHidden(0)).toBe(true);
    s.setSearchQuery("");
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isRowHidden(1)).toBe(false);
    expect(s.isCellMatched(1, 0)).toBe(false);
  });

  it("a query matching nothing hides every used-range row", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setSearchQuery("zzz");
    expect(s.isRowHidden(0)).toBe(true);
    expect(s.isRowHidden(1)).toBe(true);
    expect(s.isRowHidden(2)).toBe(true);
    expect(s.isRowHidden(3)).toBe(true);
  });

  it("does nothing on an empty sheet", () => {
    const s = make();
    s.setSearchCols([0, 1]);
    s.setSearchQuery("anything");
    expect(s.isRowHidden(0)).toBe(false);
  });

  it("re-evaluates on the next store change when a cell is edited", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setSearchQuery("cherry");
    expect(s.isRowHidden(3)).toBe(false);
    s.setCells([{ row: 3, col: 0, raw: "Durian" }]);
    expect(s.isRowHidden(3)).toBe(true);
    s.setCells([{ row: 0, col: 0, raw: "Cherry pie" }]);
    expect(s.isRowHidden(0)).toBe(false);
  });

  it("with no setSearchCols call, the default column set is empty, so no rows hide", () => {
    const s = make();
    seed(s);
    s.setSearchQuery("apple"); // no setSearchCols call at all
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isCellMatched(0, 0)).toBe(false);
  });
});

describe("isCellMatched", () => {
  it("flags exactly the cells whose display matched", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setSearchQuery("an");
    expect(s.isCellMatched(1, 0)).toBe(true); // Banana
    expect(s.isCellMatched(3, 1)).toBe(true); // banana split
    expect(s.isCellMatched(0, 0)).toBe(false); // Apple
    expect(s.isCellMatched(3, 0)).toBe(false); // Cherry (no match itself)
  });
});

describe("setSearchCols", () => {
  it("only matches within the given columns", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0]); // column 0 only
    s.setSearchQuery("banana");
    expect(s.isRowHidden(1)).toBe(false); // Banana in col 0
    expect(s.isRowHidden(3)).toBe(true); // "banana split" is in col 1, out of scope
    expect(s.isCellMatched(3, 1)).toBe(false);
  });

  it("passing every column widens matching back out (the 'search everything' case)", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0]);
    s.setSearchQuery("banana");
    expect(s.isRowHidden(3)).toBe(true);
    s.setSearchCols([0, 1]); // every column in the sheet
    expect(s.isRowHidden(3)).toBe(false);
  });

  it("re-calling with a different single column re-scopes matching live", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0]);
    s.setSearchQuery("banana");
    expect(s.isRowHidden(3)).toBe(true); // "banana split" is in col 1
    s.setSearchCols([1]); // simulate the grid selection moving to column 1
    expect(s.isRowHidden(1)).toBe(true); // "Banana" (col 0) now out of scope
    expect(s.isRowHidden(3)).toBe(false); // "banana split" (col 1) now in scope
  });

  it("an empty column set has nothing to scan, so no rows hide", () => {
    const s = make();
    seed(s);
    s.setSearchCols([]);
    s.setSearchQuery("apple");
    expect(s.isRowHidden(0)).toBe(false);
    expect(s.isCellMatched(0, 0)).toBe(false);
  });

  it("ignores out-of-range columns in the given set", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 99, -1]);
    s.setSearchQuery("apple");
    expect(s.isRowHidden(0)).toBe(false);
  });
});

describe("interaction with column filters", () => {
  it("a row hidden by a column filter stays hidden even if search matches", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setColFilter(0, new Set(["Banana"])); // only row 1 passes the filter
    s.setSearchQuery("apple"); // matches rows 0 and 2, but they're filtered out
    expect(s.isRowHidden(0)).toBe(true);
    expect(s.isRowHidden(2)).toBe(true);
    expect(s.isRowHidden(1)).toBe(true); // matches filter, not search
  });

  it("a row matching both filter and search is visible", () => {
    const s = make();
    seed(s);
    s.setSearchCols([0, 1]);
    s.setColFilter(0, new Set(["Apple"]));
    s.setSearchQuery("fresh");
    expect(s.isRowHidden(0)).toBe(false); // Apple + fresh
    expect(s.isRowHidden(2)).toBe(true); // Apple + old (search fails)
  });
});
