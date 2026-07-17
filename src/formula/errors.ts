// Excel-style formula error values.
// Features: FormulaError carrying an Excel error code, plus the known codes.
// Errors propagate through operators/functions like Excel error values do.
// Recent changes: initial implementation.

export type ErrorCode =
  | "#NAME?"
  | "#VALUE!"
  | "#DIV/0!"
  | "#REF!"
  | "#CYCLE!";

export class FormulaError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
    this.name = "FormulaError";
  }
}
