// Unit tests for TSV/CSV serialization: round-trips, quoting of
// delimiters/newlines/quotes, and Excel-style trailing-newline handling.
// Recent changes: added toCSV/parseCSV coverage (comma quoting, embedded
// newlines/quotes, CRLF, round-trip) alongside the TSV suite.

import { describe, expect, it } from "vitest";
import { parseCSV, parseTSV, toCSV, toTSV } from "./tsv";

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

describe("toCSV", () => {
  it("joins with commas and newlines", () => {
    expect(
      toCSV([
        ["a", "b"],
        ["c", "d"],
      ])
    ).toBe("a,b\nc,d");
  });

  it("quotes cells containing commas, newlines, or quotes", () => {
    expect(toCSV([["Smith, John", 'say "hi"', "l1\nl2", "plain"]])).toBe(
      '"Smith, John","say ""hi""","l1\nl2",plain'
    );
  });

  it("does not quote tabs (CSV delimiter is the comma)", () => {
    expect(toCSV([["a\tb"]])).toBe("a\tb");
  });
});

describe("parseCSV", () => {
  it("parses a simple matrix", () => {
    expect(parseCSV("1,2\n3,4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quoted fields with embedded commas, newlines, and escapes", () => {
    expect(parseCSV('"Smith, John","l1\nl2","say ""hi"""')).toEqual([
      ["Smith, John", "l1\nl2", 'say "hi"'],
    ]);
  });

  it("handles \\r\\n line endings and a trailing newline", () => {
    expect(parseCSV("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("preserves empty cells", () => {
    expect(parseCSV("a,,b")).toEqual([["a", "", "b"]]);
  });

  it("round-trips through toCSV", () => {
    const matrix = [
      ["plain", 'has "quotes"', "has,comma"],
      ["", "multi\nline", "=SUM(1,2)"],
    ];
    expect(parseCSV(toCSV(matrix))).toEqual(matrix);
  });
});
