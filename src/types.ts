// Shared public + internal types for the excel-grid library.
// Features: cell/coord/range models, change events, cell style model
// (bold/italic/underline/strike, font size, colors, alignment, number
// formats), component props and imperative handle types re-exported from
// src/index.ts.
// Recent changes: added CellStyle/NumFmt/HAlign and the toolbar prop for the
// WeCom-style toolbar.

/** A computed scalar value a cell can hold. */
export type CellValue = string | number | boolean | null;

/** Zero-based cell coordinate. */
export interface CellCoord {
  row: number;
  col: number;
}

/** Normalized rectangular range (start <= end on both axes), zero-based inclusive. */
export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** Stored record for a non-empty cell. */
export interface CellData {
  /** Raw text as typed by the user (formula text starts with "="). */
  raw: string;
  /** Computed value (for formulas) or parsed literal. */
  value: CellValue;
  /** Excel-style error code (e.g. "#DIV/0!") when evaluation failed. */
  error?: string;
}

/** Number display format applied on top of a numeric cell value. */
export type NumFmt = "general" | "percent" | "thousands";

/** Horizontal cell alignment. */
export type HAlign = "left" | "center" | "right";

/**
 * Visual style of one cell, stored sparsely and independent of the cell's
 * value (an empty cell can carry a fill color). All fields optional; an
 * absent field means "default".
 */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Font size in px. */
  fontSize?: number;
  /** Text color (CSS color). */
  color?: string;
  /** Fill / background color (CSS color). */
  background?: string;
  align?: HAlign;
  numFmt?: NumFmt;
  /** Fixed decimal places for numeric display (0-10). */
  decimals?: number;
}

/** One changed cell reported through onChange. */
export interface GridChange {
  row: number;
  col: number;
  /** A1-style reference for convenience. */
  ref: string;
  raw: string | null;
  value: CellValue;
  error?: string;
}

/** Props for the ExcelGrid component. */
export interface ExcelGridProps {
  /** Total row count. Default 1000. */
  rows?: number;
  /** Total column count. Default 26. */
  cols?: number;
  /** Initial cell contents keyed by A1-style reference, e.g. { A1: "=B1+1" }. */
  initialCells?: Record<string, string>;
  /** Called after each committed change batch (edit, paste, clear, fill, undo, redo). */
  onChange?: (changes: GridChange[]) => void;
  /** Row height in px. Default 24. */
  rowHeight?: number;
  /** Default column width in px. Default 100. */
  defaultColWidth?: number;
  /** Extra class on the root element. */
  className?: string;
  /** Show the WeCom-style formatting toolbar above the formula bar. Default true. */
  toolbar?: boolean;
}

/** Imperative API exposed through the component ref. */
export interface ExcelGridHandle {
  /** Read a cell by A1-style reference. Returns null for empty cells. */
  getCell(ref: string): CellData | null;
  /** Write a cell's raw text by A1-style reference (undoable, triggers recalc). */
  setCell(ref: string, raw: string): void;
  /** All non-empty cells as { ref, raw, value }. */
  getData(): Array<{ ref: string; raw: string; value: CellValue }>;
}
