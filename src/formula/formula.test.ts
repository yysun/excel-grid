// Unit tests for the formula engine: tokenizer/parser precedence, evaluator
// coercions and operators, every built-in function, error values, and
// reference adjustment for copy/paste/fill.

import { describe, expect, it } from "vitest";
import type { CellRange, CellValue } from "../types";
import { rangeCoords } from "../utils/cellRef";
import { adjustFormula, extractRefs } from "./adjust";
import { FormulaError } from "./errors";
import { evaluate, type EvalContext } from "./evaluate";
import { parse } from "./parser";

/** Evaluate a formula body against a small fixture sheet. */
function run(body: string, cells: Record<string, CellValue> = {}): CellValue {
  const byKey = new Map<string, CellValue>();
  for (const [ref, v] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
    byKey.set(`${+m[2] - 1},${col - 1}`, v);
  }
  const ctx: EvalContext = {
    getCellValue: (row, col) => byKey.get(`${row},${col}`) ?? null,
    getRangeValues: (range: CellRange) => {
      const out: CellValue[] = [];
      for (const { row, col } of rangeCoords(range)) {
        out.push(byKey.get(`${row},${col}`) ?? null);
      }
      return out;
    },
  };
  return evaluate(parse(body), ctx);
}

function code(body: string, cells: Record<string, CellValue> = {}): string {
  try {
    run(body, cells);
    return "(no error)";
  } catch (e) {
    return e instanceof FormulaError ? e.code : String(e);
  }
}

describe("operators and precedence", () => {
  it("basic arithmetic with precedence", () => {
    expect(run("1+2*3")).toBe(7);
    expect(run("(1+2)*3")).toBe(9);
    expect(run("10-4/2")).toBe(8);
  });

  it("exponent is right-associative and binds looser than unary minus", () => {
    expect(run("2^3^2")).toBe(512);
    expect(run("-2^2")).toBe(4); // Excel: (-2)^2
  });

  it("postfix percent", () => {
    expect(run("50%")).toBe(0.5);
    expect(run("200*10%")).toBe(20);
  });

  it("concatenation", () => {
    expect(run('"a"&"b"&1')).toBe("ab1");
    expect(run('A1&" pts"', { A1: 1 })).toBe("1 pts");
  });

  it("comparisons", () => {
    expect(run("1<2")).toBe(true);
    expect(run("2<=2")).toBe(true);
    expect(run("3<>3")).toBe(false);
    expect(run('"abc"="ABC"')).toBe(true); // case-insensitive text equality
    expect(run('"a"<"b"')).toBe(true);
    expect(run('2>"1"')).toBe(false); // Excel: any text sorts above numbers
  });

  it("coercions in arithmetic", () => {
    expect(run('A1+1', { A1: "41" })).toBe(42);
    expect(run("TRUE+1")).toBe(2);
    expect(run("A1+5", {})).toBe(5); // empty cell -> 0
  });
});

describe("functions", () => {
  const sheet = { A1: 1, A2: 10, A3: 3, B1: "x" };

  it("SUM / AVERAGE / MIN / MAX", () => {
    expect(run("SUM(A1:A3)", sheet)).toBe(14);
    expect(run("SUM(A1:B3)", sheet)).toBe(14); // text in ranges skipped
    expect(run("SUM(1,2,A1)", sheet)).toBe(4);
    expect(run("AVERAGE(A1:A3)", sheet)).toBeCloseTo(14 / 3);
    expect(run("MIN(A1:A3)", sheet)).toBe(1);
    expect(run("MAX(A1:A3)", sheet)).toBe(10);
  });

  it("COUNT / COUNTA", () => {
    expect(run("COUNT(A1:B3)", sheet)).toBe(3);
    expect(run("COUNTA(A1:B3)", sheet)).toBe(4);
  });

  it("IF is lazy and defaults the else-branch to FALSE", () => {
    expect(run('IF(A2>5,"big","small")', sheet)).toBe("big");
    expect(run('IF(A2<5,"big","small")', sheet)).toBe("small");
    expect(run("IF(TRUE,1,1/0)")).toBe(1); // untaken branch never evaluates
    expect(run("IF(FALSE,1)")).toBe(false);
  });

  it("ROUND / ABS", () => {
    expect(run("ROUND(2.345,2)")).toBeCloseTo(2.35);
    expect(run("ROUND(2.5)")).toBe(3);
    expect(run("ROUND(-2.5)")).toBe(-3); // half away from zero
    expect(run("ROUND(1234,-2)")).toBe(1200);
    expect(run("ABS(-3)")).toBe(3);
  });

  it("CONCATENATE / AND / OR / NOT", () => {
    expect(run('CONCATENATE("a",1,TRUE)')).toBe("a1TRUE");
    expect(run("AND(TRUE,1)")).toBe(true);
    expect(run("AND(TRUE,0)")).toBe(false);
    expect(run("OR(FALSE,0,1)")).toBe(true);
    expect(run("NOT(TRUE)")).toBe(false);
  });

  it("function names are case-insensitive", () => {
    expect(run("sum(1,2)")).toBe(3);
  });
});

describe("error values", () => {
  it("#DIV/0!", () => {
    expect(code("1/0")).toBe("#DIV/0!");
    expect(code("AVERAGE(B1:B3)")).toBe("#DIV/0!"); // no numeric values
  });

  it("#NAME? for unknown functions", () => {
    expect(code("NOSUCHFN(1)")).toBe("#NAME?");
  });

  it("#VALUE! for bad coercions and syntax", () => {
    expect(code('"abc"+1')).toBe("#VALUE!");
    expect(code("1+")).toBe("#VALUE!");
    expect(code("A1:B2+1")).toBe("#VALUE!"); // bare range as scalar
    expect(code('"unterminated')).toBe("#VALUE!");
  });
});

describe("adjustFormula", () => {
  it("shifts relative references", () => {
    expect(adjustFormula("=A1+B1", 2, 0, 100, 100)).toBe("=A3+B3");
    expect(adjustFormula("=SUM(A1:B2)", 1, 1, 100, 100)).toBe("=SUM(B2:C3)");
  });

  it("keeps $-anchored axes fixed", () => {
    expect(adjustFormula("=$A$1+A1", 1, 1, 100, 100)).toBe("=$A$1+B2");
    expect(adjustFormula("=A$1+$A1", 1, 1, 100, 100)).toBe("=B$1+$A2");
  });

  it("produces #REF! when shifted out of bounds", () => {
    expect(adjustFormula("=A1+B5", -1, 0, 100, 100)).toBe("=#REF!+B4");
    expect(adjustFormula("=A1", 0, 100, 100, 100)).toBe("=#REF!");
  });

  it("leaves strings and function names untouched", () => {
    expect(adjustFormula('=CONCATENATE("A1",A1)', 1, 0, 100, 100)).toBe(
      '=CONCATENATE("A1",A2)'
    );
  });
});

describe("extractRefs", () => {
  it("collects cells and ranges", () => {
    const refs = extractRefs(parse("A1+SUM(B2:C3)-IF(D4>0,E5,1)"));
    expect(refs.cells.map((c) => `${c.row},${c.col}`)).toEqual([
      "0,0",
      "3,3",
      "4,4",
    ]);
    expect(refs.ranges).toEqual([
      { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
    ]);
  });
});
