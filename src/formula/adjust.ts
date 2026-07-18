// Formula reference adjustment for copy/paste, fill, and structural edits.
// Features: shifts relative cell references in a formula string by a
// (row, col) offset; $-anchored axes stay fixed; references pushed out of
// bounds are replaced with #REF!. remapFormulaAxis rewrites every reference
// (anchored or not) through a row/col index mapping for insert/delete/move.
// Also extracts referenced cells/ranges from an AST for dependency tracking.
// Recent changes: added remapFormulaAxis for the context-menu structural ops.

import { formatParsedRef, type ParsedRef } from "../utils/cellRef";
import type { CellRange } from "../types";
import { normalizeRange } from "../utils/cellRef";
import { FormulaError } from "./errors";
import type { Ast } from "./parser";
import { tokenize } from "./tokenizer";

/**
 * Shift relative references in a formula (including the leading "=") by
 * (dRow, dCol). Returns the rewritten formula text.
 */
export function adjustFormula(
  formula: string,
  dRow: number,
  dCol: number,
  rowCount: number,
  colCount: number
): string {
  const body = formula.slice(1);
  let tokens;
  try {
    tokens = tokenize(body);
  } catch {
    return formula; // Unparseable text is left untouched.
  }
  let out = "";
  let last = 0;
  for (const t of tokens) {
    if (t.type !== "ref") continue;
    const moved: ParsedRef = {
      row: t.ref.absRow ? t.ref.row : t.ref.row + dRow,
      col: t.ref.absCol ? t.ref.col : t.ref.col + dCol,
      absRow: t.ref.absRow,
      absCol: t.ref.absCol,
    };
    const replacement =
      moved.row < 0 || moved.col < 0 || moved.row >= rowCount || moved.col >= colCount
        ? "#REF!"
        : formatParsedRef(moved);
    out += body.slice(last, t.start) + replacement;
    last = t.end;
  }
  out += body.slice(last);
  return "=" + out;
}

/**
 * Rewrite every reference of a formula through an index mapping on one axis
 * (for insert/delete/move of rows or columns). Unlike adjustFormula, $
 * anchors do not pin a reference: structural edits move anchored refs too.
 * A reference whose mapped index is null or out of bounds becomes #REF!.
 */
export function remapFormulaAxis(
  formula: string,
  axis: "row" | "col",
  map: (index: number) => number | null,
  rowCount: number,
  colCount: number
): string {
  const body = formula.slice(1);
  let tokens;
  try {
    tokens = tokenize(body);
  } catch {
    return formula; // Unparseable text is left untouched.
  }
  let out = "";
  let last = 0;
  for (const t of tokens) {
    if (t.type !== "ref") continue;
    const row = axis === "row" ? map(t.ref.row) : t.ref.row;
    const col = axis === "col" ? map(t.ref.col) : t.ref.col;
    const replacement =
      row === null || col === null || row < 0 || col < 0 || row >= rowCount || col >= colCount
        ? "#REF!"
        : formatParsedRef({ row, col, absRow: t.ref.absRow, absCol: t.ref.absCol });
    out += body.slice(last, t.start) + replacement;
    last = t.end;
  }
  out += body.slice(last);
  return "=" + out;
}

/** Referenced single cells and ranges of a formula AST. */
export interface AstRefs {
  cells: Array<{ row: number; col: number }>;
  ranges: CellRange[];
}

/** Collect every cell/range reference in an AST (for the dependency graph). */
export function extractRefs(ast: Ast): AstRefs {
  const refs: AstRefs = { cells: [], ranges: [] };
  const walk = (node: Ast): void => {
    switch (node.t) {
      case "ref":
        refs.cells.push({ row: node.ref.row, col: node.ref.col });
        break;
      case "range":
        refs.ranges.push(
          normalizeRange(
            { row: node.start.row, col: node.start.col },
            { row: node.end.row, col: node.end.col }
          )
        );
        break;
      case "bin":
        walk(node.l);
        walk(node.r);
        break;
      case "neg":
      case "pct":
        walk(node.v);
        break;
      case "call":
        node.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return refs;
}

/** True if the formula text contains a literal #REF! marker (post-adjustment). */
export function hasRefError(formula: string): boolean {
  return formula.includes("#REF!");
}

export { FormulaError };
