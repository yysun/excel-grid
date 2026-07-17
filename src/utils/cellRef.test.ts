// Unit tests for A1-reference utilities: letter round-trips (incl. Z->AA),
// $-anchor parsing, range parsing/normalization, and key round-trips.

import { describe, expect, it } from "vitest";
import {
  cellKey,
  colToLetters,
  formatCellRef,
  formatParsedRef,
  lettersToCol,
  normalizeRange,
  parseCellRef,
  parseKey,
  parseRange,
  rangeContains,
} from "./cellRef";

describe("colToLetters / lettersToCol", () => {
  it("round-trips single letters", () => {
    expect(colToLetters(0)).toBe("A");
    expect(colToLetters(25)).toBe("Z");
    expect(lettersToCol("A")).toBe(0);
    expect(lettersToCol("Z")).toBe(25);
  });

  it("handles the Z -> AA boundary and beyond", () => {
    expect(colToLetters(26)).toBe("AA");
    expect(colToLetters(51)).toBe("AZ");
    expect(colToLetters(52)).toBe("BA");
    expect(colToLetters(701)).toBe("ZZ");
    expect(colToLetters(702)).toBe("AAA");
    for (const i of [0, 25, 26, 99, 701, 702, 16383]) {
      expect(lettersToCol(colToLetters(i))).toBe(i);
    }
  });

  it("is case-insensitive", () => {
    expect(lettersToCol("aa")).toBe(26);
  });
});

describe("parseCellRef / formatCellRef", () => {
  it("parses plain references", () => {
    expect(parseCellRef("B2")).toEqual({
      row: 1,
      col: 1,
      absRow: false,
      absCol: false,
    });
    expect(parseCellRef("cv10000")).toEqual({
      row: 9999,
      col: 99,
      absRow: false,
      absCol: false,
    });
  });

  it("parses $ anchors", () => {
    expect(parseCellRef("$A$1")).toEqual({
      row: 0,
      col: 0,
      absRow: true,
      absCol: true,
    });
    expect(parseCellRef("$A1")?.absCol).toBe(true);
    expect(parseCellRef("A$1")?.absRow).toBe(true);
  });

  it("rejects invalid refs", () => {
    expect(parseCellRef("A0")).toBeNull();
    expect(parseCellRef("1A")).toBeNull();
    expect(parseCellRef("SUM")).toBeNull();
    expect(parseCellRef("")).toBeNull();
  });

  it("formats", () => {
    expect(formatCellRef(0, 0)).toBe("A1");
    expect(formatCellRef(9, 27)).toBe("AB10");
    expect(
      formatParsedRef({ row: 1, col: 1, absRow: true, absCol: false })
    ).toBe("B$2");
  });
});

describe("parseRange / normalizeRange", () => {
  it("parses and normalizes reversed corners", () => {
    expect(parseRange("B3:A1")).toEqual({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 1,
    });
  });

  it("accepts single-cell ranges", () => {
    expect(parseRange("C4")).toEqual({
      startRow: 3,
      endRow: 3,
      startCol: 2,
      endCol: 2,
    });
  });

  it("rejects malformed input", () => {
    expect(parseRange("A1:B2:C3")).toBeNull();
    expect(parseRange("A1:xx")).toBeNull();
  });

  it("normalizeRange orders both axes", () => {
    expect(
      normalizeRange({ row: 5, col: 1 }, { row: 2, col: 4 })
    ).toEqual({ startRow: 2, endRow: 5, startCol: 1, endCol: 4 });
  });

  it("rangeContains checks bounds inclusively", () => {
    const r = { startRow: 1, endRow: 3, startCol: 1, endCol: 3 };
    expect(rangeContains(r, 1, 3)).toBe(true);
    expect(rangeContains(r, 0, 2)).toBe(false);
  });
});

describe("cellKey / parseKey", () => {
  it("round-trips", () => {
    expect(parseKey(cellKey(12, 34))).toEqual({ row: 12, col: 34 });
  });
});
