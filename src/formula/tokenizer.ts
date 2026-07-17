// Formula tokenizer.
// Features: tokenizes formula bodies (text after "=") into numbers, strings,
// booleans, cell refs (with $ anchors), identifiers (function names),
// operators (+ - * / ^ % & = <> < <= > >=), parens, commas, and range colons.
// Tokens carry start/end offsets so adjust.ts can rewrite references in place.
// Recent changes: initial implementation.

import { parseCellRef, type ParsedRef } from "../utils/cellRef";
import { FormulaError } from "./errors";

export type Token =
  | { type: "num"; value: number; start: number; end: number }
  | { type: "str"; value: string; start: number; end: number }
  | { type: "bool"; value: boolean; start: number; end: number }
  | { type: "ref"; ref: ParsedRef; start: number; end: number }
  | { type: "ident"; name: string; start: number; end: number }
  | { type: "op"; op: string; start: number; end: number };

const TWO_CHAR_OPS = ["<=", ">=", "<>"];
const ONE_CHAR_OPS = "+-*/^%&=<>(),:";

/** Tokenize a formula body. Throws FormulaError("#VALUE!") on malformed input. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    // String literal
    if (ch === '"') {
      const start = i;
      i++;
      let value = "";
      let closed = false;
      while (i < input.length) {
        if (input[i] === '"') {
          if (input[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++;
            closed = true;
            break;
          }
        } else {
          value += input[i++];
        }
      }
      if (!closed) throw new FormulaError("#VALUE!");
      tokens.push({ type: "str", value, start, end: i });
      continue;
    }
    // Number
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      const start = i;
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (!m) throw new FormulaError("#VALUE!");
      i += m[0].length;
      tokens.push({ type: "num", value: parseFloat(m[0]), start, end: i });
      continue;
    }
    // Word: cell ref, boolean, or identifier ($ allowed for anchors)
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      const m = /^[$A-Za-z_][$A-Za-z0-9_.]*/.exec(input.slice(i))!;
      const word = m[0];
      i += word.length;
      const ref = parseCellRef(word);
      if (ref) {
        tokens.push({ type: "ref", ref, start, end: i });
      } else if (/^(true|false)$/i.test(word)) {
        tokens.push({ type: "bool", value: /^true$/i.test(word), start, end: i });
      } else {
        tokens.push({ type: "ident", name: word.toUpperCase(), start, end: i });
      }
      continue;
    }
    // Operators / punctuation
    const two = input.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: "op", op: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: "op", op: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    throw new FormulaError("#VALUE!");
  }
  return tokens;
}
