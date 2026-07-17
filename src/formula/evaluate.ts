// Formula AST evaluator.
// Features: evaluates parsed formulas against a cell-value resolver, with
// Excel-style coercion (arithmetic coerces null->0, bool->1/0, numeric text),
// error propagation, lazy IF, postfix %, & concatenation, and comparisons
// (case-insensitive text, Excel type ordering number < text < boolean).
// Recent changes: initial implementation.

import type { CellRange, CellValue } from "../types";
import { normalizeRange } from "../utils/cellRef";
import { FormulaError } from "./errors";
import { FUNCTIONS, type FnArg } from "./functions";
import type { Ast } from "./parser";

export interface EvalContext {
  /** Resolve a cell's computed value. Must throw FormulaError if that cell is in error. */
  getCellValue(row: number, col: number): CellValue;
  /** Row-major values of a range (empty cells as null). */
  getRangeValues(range: CellRange): CellValue[];
}

export function toNumber(v: CellValue): number {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const trimmed = v.trim();
  if (trimmed !== "" && !isNaN(Number(trimmed))) return Number(trimmed);
  throw new FormulaError("#VALUE!");
}

export function toText(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

export function toBoolean(v: CellValue): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  throw new FormulaError("#VALUE!");
}

function typeOrder(v: CellValue): number {
  if (typeof v === "number" || v === null) return 0;
  if (typeof v === "string") return 1;
  return 2; // boolean
}

function compare(l: CellValue, r: CellValue): number {
  const lo = typeOrder(l);
  const ro = typeOrder(r);
  if (lo !== ro) return lo - ro;
  if (lo === 0) return (l === null ? 0 : (l as number)) - (r === null ? 0 : (r as number));
  if (lo === 1) {
    const a = (l as string).toLowerCase();
    const b = (r as string).toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return (l === r ? 0 : l ? 1 : -1);
}

/** Evaluate an AST. Throws FormulaError on any evaluation failure. */
export function evaluate(ast: Ast, ctx: EvalContext): CellValue {
  switch (ast.t) {
    case "num":
      return ast.v;
    case "str":
      return ast.v;
    case "bool":
      return ast.v;
    case "ref":
      return ctx.getCellValue(ast.ref.row, ast.ref.col);
    case "range":
      // A bare range is not a scalar; only functions accept ranges.
      throw new FormulaError("#VALUE!");
    case "neg":
      return -toNumber(evaluate(ast.v, ctx));
    case "pct":
      return toNumber(evaluate(ast.v, ctx)) / 100;
    case "bin": {
      const { op } = ast;
      if (["=", "<>", "<", "<=", ">", ">="].includes(op)) {
        const c = compare(evaluate(ast.l, ctx), evaluate(ast.r, ctx));
        switch (op) {
          case "=":
            return c === 0;
          case "<>":
            return c !== 0;
          case "<":
            return c < 0;
          case "<=":
            return c <= 0;
          case ">":
            return c > 0;
          default:
            return c >= 0;
        }
      }
      if (op === "&") {
        return toText(evaluate(ast.l, ctx)) + toText(evaluate(ast.r, ctx));
      }
      const l = toNumber(evaluate(ast.l, ctx));
      const r = toNumber(evaluate(ast.r, ctx));
      switch (op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) throw new FormulaError("#DIV/0!");
          return l / r;
        case "^":
          return Math.pow(l, r);
        default:
          throw new FormulaError("#VALUE!");
      }
    }
    case "call": {
      // Lazy IF so untaken branches never evaluate (matches Excel).
      if (ast.name === "IF") {
        if (ast.args.length < 2 || ast.args.length > 3) {
          throw new FormulaError("#VALUE!");
        }
        const cond = toBoolean(evaluate(ast.args[0], ctx));
        if (cond) return evaluate(ast.args[1], ctx);
        return ast.args.length === 3 ? evaluate(ast.args[2], ctx) : false;
      }
      const fn = FUNCTIONS[ast.name];
      if (!fn) throw new FormulaError("#NAME?");
      const args: FnArg[] = ast.args.map((a) => {
        if (a.t === "range") {
          const range = normalizeRange(
            { row: a.start.row, col: a.start.col },
            { row: a.end.row, col: a.end.col }
          );
          return { kind: "range", values: ctx.getRangeValues(range) };
        }
        return { kind: "scalar", value: evaluate(a, ctx) };
      });
      return fn(args);
    }
  }
}
