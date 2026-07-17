// A1-style cell reference utilities.
// Features: column index <-> letters (A..Z, AA..), parse/format cell refs with
// optional $ anchors, range parsing/normalization, and "row,col" map keys.
// Recent changes: initial implementation.

import type { CellCoord, CellRange } from "../types";

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colToLetters(col: number): string {
  let s = "";
  let n = col;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. Case-insensitive. */
export function lettersToCol(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return n - 1;
}

/** A parsed A1-style reference with $-anchor flags. */
export interface ParsedRef {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d{0,6})$/;

/** Parse "B2", "$B$2", etc. Returns null if not a valid cell reference. */
export function parseCellRef(text: string): ParsedRef | null {
  const m = REF_RE.exec(text);
  if (!m) return null;
  return {
    col: lettersToCol(m[2]),
    row: parseInt(m[4], 10) - 1,
    absCol: m[1] === "$",
    absRow: m[3] === "$",
  };
}

/** Format a coordinate as an A1-style reference (no anchors). */
export function formatCellRef(row: number, col: number): string {
  return colToLetters(col) + (row + 1);
}

/** Format a ParsedRef preserving $ anchors. */
export function formatParsedRef(ref: ParsedRef): string {
  return (
    (ref.absCol ? "$" : "") +
    colToLetters(ref.col) +
    (ref.absRow ? "$" : "") +
    (ref.row + 1)
  );
}

/** Normalize two corners into a CellRange. */
export function normalizeRange(a: CellCoord, b: CellCoord): CellRange {
  return {
    startRow: Math.min(a.row, b.row),
    endRow: Math.max(a.row, b.row),
    startCol: Math.min(a.col, b.col),
    endCol: Math.max(a.col, b.col),
  };
}

/** Parse "A1:B3" or "A1" into a normalized range. Returns null if invalid. */
export function parseRange(text: string): CellRange | null {
  const parts = text.split(":");
  if (parts.length > 2) return null;
  const start = parseCellRef(parts[0]);
  if (!start) return null;
  const end = parts.length === 2 ? parseCellRef(parts[1]) : start;
  if (!end) return null;
  return normalizeRange(
    { row: start.row, col: start.col },
    { row: end.row, col: end.col }
  );
}

/** Map key for sparse cell storage. */
export function cellKey(row: number, col: number): string {
  return row + "," + col;
}

/** Inverse of cellKey. */
export function parseKey(key: string): CellCoord {
  const i = key.indexOf(",");
  return { row: +key.slice(0, i), col: +key.slice(i + 1) };
}

/** True if the coordinate lies inside the range. */
export function rangeContains(r: CellRange, row: number, col: number): boolean {
  return (
    row >= r.startRow && row <= r.endRow && col >= r.startCol && col <= r.endCol
  );
}

/** Iterate every coordinate of a range in row-major order. */
export function* rangeCoords(r: CellRange): Generator<CellCoord> {
  for (let row = r.startRow; row <= r.endRow; row++) {
    for (let col = r.startCol; col <= r.endCol; col++) {
      yield { row, col };
    }
  }
}
