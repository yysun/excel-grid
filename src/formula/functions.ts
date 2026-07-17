// Built-in spreadsheet functions.
// Features: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, ROUND, ABS, CONCATENATE,
// AND, OR, NOT over scalar and range arguments. Range args skip non-numeric
// values for numeric aggregates (Excel behavior); scalar args coerce strictly.
// IF is special-cased (lazy) in evaluate.ts and not listed here.
// Recent changes: initial implementation.

import type { CellValue } from "../types";
import { FormulaError } from "./errors";
import { toBoolean, toNumber, toText } from "./evaluate";

export type FnArg =
  | { kind: "scalar"; value: CellValue }
  | { kind: "range"; values: CellValue[] };

export type FnImpl = (args: FnArg[]) => CellValue;

/** Numbers from args: range cells only count if actually numeric; scalars coerce (throwing #VALUE! when impossible). */
function numericArgs(args: FnArg[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (a.kind === "range") {
      for (const v of a.values) {
        if (typeof v === "number") out.push(v);
      }
    } else {
      out.push(toNumber(a.value));
    }
  }
  return out;
}

function allValues(args: FnArg[]): CellValue[] {
  const out: CellValue[] = [];
  for (const a of args) {
    if (a.kind === "range") out.push(...a.values);
    else out.push(a.value);
  }
  return out;
}

function booleanArgs(args: FnArg[]): boolean[] {
  const out: boolean[] = [];
  for (const a of args) {
    if (a.kind === "range") {
      for (const v of a.values) {
        if (typeof v === "boolean") out.push(v);
        else if (typeof v === "number") out.push(v !== 0);
        // Text/empty cells in ranges are ignored, as in Excel AND/OR.
      }
    } else {
      out.push(toBoolean(a.value));
    }
  }
  if (out.length === 0) throw new FormulaError("#VALUE!");
  return out;
}

export const FUNCTIONS: Record<string, FnImpl> = {
  SUM: (args) => numericArgs(args).reduce((a, b) => a + b, 0),
  AVERAGE: (args) => {
    const nums = numericArgs(args);
    if (nums.length === 0) throw new FormulaError("#DIV/0!");
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },
  MIN: (args) => {
    const nums = numericArgs(args);
    return nums.length === 0 ? 0 : Math.min(...nums);
  },
  MAX: (args) => {
    const nums = numericArgs(args);
    return nums.length === 0 ? 0 : Math.max(...nums);
  },
  COUNT: (args) => {
    let n = 0;
    for (const a of args) {
      if (a.kind === "range") {
        for (const v of a.values) if (typeof v === "number") n++;
      } else {
        const v = a.value;
        if (
          typeof v === "number" ||
          (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)))
        ) {
          n++;
        }
      }
    }
    return n;
  },
  COUNTA: (args) => {
    let n = 0;
    for (const v of allValues(args)) {
      if (v !== null && v !== "") n++;
    }
    return n;
  },
  ROUND: (args) => {
    if (args.length < 1 || args.length > 2) throw new FormulaError("#VALUE!");
    if (args[0].kind !== "scalar" || (args[1] && args[1].kind !== "scalar")) {
      throw new FormulaError("#VALUE!");
    }
    const n = toNumber(args[0].value);
    const digits = args.length === 2 ? Math.trunc(toNumber((args[1] as { kind: "scalar"; value: CellValue }).value)) : 0;
    const factor = Math.pow(10, digits);
    // Round half away from zero, like Excel (JS Math.round rounds -0.5 to 0).
    return Math.sign(n) * Math.round(Math.abs(n) * factor) / factor;
  },
  ABS: (args) => {
    if (args.length !== 1 || args[0].kind !== "scalar") {
      throw new FormulaError("#VALUE!");
    }
    return Math.abs(toNumber(args[0].value));
  },
  CONCATENATE: (args) => allValues(args).map(toText).join(""),
  AND: (args) => booleanArgs(args).every(Boolean),
  OR: (args) => booleanArgs(args).some(Boolean),
  NOT: (args) => {
    if (args.length !== 1 || args[0].kind !== "scalar") {
      throw new FormulaError("#VALUE!");
    }
    return !toBoolean(args[0].value);
  },
};
