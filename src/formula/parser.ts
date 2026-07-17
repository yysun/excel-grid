// Recursive-descent formula parser producing an AST.
// Features: Excel operator precedence — comparisons < & < +- < */ < ^ (right
// assoc) < unary +/- < postfix % < primary; ranges (A1:B3), function calls,
// parenthesized expressions.
// Recent changes: initial implementation.

import type { ParsedRef } from "../utils/cellRef";
import { FormulaError } from "./errors";
import { tokenize, type Token } from "./tokenizer";

export type Ast =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ref"; ref: ParsedRef }
  | { t: "range"; start: ParsedRef; end: ParsedRef }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  | { t: "neg"; v: Ast }
  | { t: "pct"; v: Ast }
  | { t: "call"; name: string; args: Ast[] };

/** Parse a formula body (text after "="). Throws FormulaError("#VALUE!") on syntax errors. */
export function parse(input: string): Ast {
  const tokens = tokenize(input);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const isOp = (op: string): boolean => {
    const t = peek();
    return t?.type === "op" && t.op === op;
  };
  const expectOp = (op: string): void => {
    if (!isOp(op)) throw new FormulaError("#VALUE!");
    pos++;
  };

  function parseCompare(): Ast {
    let left = parseConcat();
    while (true) {
      const t = peek();
      if (t?.type === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(t.op)) {
        pos++;
        left = { t: "bin", op: t.op, l: left, r: parseConcat() };
      } else return left;
    }
  }

  function parseConcat(): Ast {
    let left = parseAdd();
    while (isOp("&")) {
      pos++;
      left = { t: "bin", op: "&", l: left, r: parseAdd() };
    }
    return left;
  }

  function parseAdd(): Ast {
    let left = parseMul();
    while (true) {
      const t = peek();
      if (t?.type === "op" && (t.op === "+" || t.op === "-")) {
        pos++;
        left = { t: "bin", op: t.op, l: left, r: parseMul() };
      } else return left;
    }
  }

  function parseMul(): Ast {
    let left = parseExp();
    while (true) {
      const t = peek();
      if (t?.type === "op" && (t.op === "*" || t.op === "/")) {
        pos++;
        left = { t: "bin", op: t.op, l: left, r: parseExp() };
      } else return left;
    }
  }

  function parseExp(): Ast {
    const left = parseUnary();
    if (isOp("^")) {
      pos++;
      return { t: "bin", op: "^", l: left, r: parseExp() };
    }
    return left;
  }

  function parseUnary(): Ast {
    if (isOp("-")) {
      pos++;
      return { t: "neg", v: parseUnary() };
    }
    if (isOp("+")) {
      pos++;
      return parseUnary();
    }
    return parsePostfix();
  }

  function parsePostfix(): Ast {
    let node = parsePrimary();
    while (isOp("%")) {
      pos++;
      node = { t: "pct", v: node };
    }
    return node;
  }

  function parsePrimary(): Ast {
    const t = peek();
    if (!t) throw new FormulaError("#VALUE!");
    if (t.type === "num") {
      pos++;
      return { t: "num", v: t.value };
    }
    if (t.type === "str") {
      pos++;
      return { t: "str", v: t.value };
    }
    if (t.type === "bool") {
      pos++;
      return { t: "bool", v: t.value };
    }
    if (t.type === "ref") {
      pos++;
      if (isOp(":")) {
        pos++;
        const end = peek();
        if (end?.type !== "ref") throw new FormulaError("#VALUE!");
        pos++;
        return { t: "range", start: t.ref, end: end.ref };
      }
      return { t: "ref", ref: t.ref };
    }
    if (t.type === "ident") {
      pos++;
      expectOp("(");
      const args: Ast[] = [];
      if (!isOp(")")) {
        args.push(parseCompare());
        while (isOp(",")) {
          pos++;
          args.push(parseCompare());
        }
      }
      expectOp(")");
      return { t: "call", name: t.name, args };
    }
    if (t.type === "op" && t.op === "(") {
      pos++;
      const inner = parseCompare();
      expectOp(")");
      return inner;
    }
    throw new FormulaError("#VALUE!");
  }

  const ast = parseCompare();
  if (pos !== tokens.length) throw new FormulaError("#VALUE!");
  return ast;
}
