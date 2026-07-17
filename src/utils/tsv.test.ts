// Unit tests for TSV serialization: round-trips, quoting of tabs/newlines/
// quotes, and Excel-style trailing-newline handling.

import { describe, expect, it } from "vitest";
import { parseTSV, toTSV } from "./tsv";

describe("toTSV", () => {
  it("joins with tabs and newlines", () => {
    expect(
      toTSV([
        ["a", "b"],
        ["c", "d"],
      ])
    ).toBe("a\tb\nc\td");
  });

  it("quotes cells containing tabs, newlines, or quotes", () => {
    expect(toTSV([['say "hi"', "a\tb", "l1\nl2"]])).toBe(
      '"say ""hi"""\t"a\tb"\t"l1\nl2"'
    );
  });
});

describe("parseTSV", () => {
  it("parses a simple matrix", () => {
    expect(parseTSV("1\t2\n3\t4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops a single trailing newline (Excel style)", () => {
    expect(parseTSV("1\t2\n")).toEqual([["1", "2"]]);
  });

  it("handles quoted fields with embedded separators and escapes", () => {
    expect(parseTSV('"a\tb"\t"l1\nl2"\t"say ""hi"""')).toEqual([
      ["a\tb", "l1\nl2", 'say "hi"'],
    ]);
  });

  it("handles \\r\\n line endings", () => {
    expect(parseTSV("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("round-trips through toTSV", () => {
    const matrix = [
      ["plain", 'has "quotes"', "has\ttab"],
      ["", "multi\nline", "=A1+B1"],
    ];
    expect(parseTSV(toTSV(matrix))).toEqual(matrix);
  });

  it("preserves empty cells", () => {
    expect(parseTSV("a\t\tb")).toEqual([["a", "", "b"]]);
  });
});
