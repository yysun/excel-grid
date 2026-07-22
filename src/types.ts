// Shared public + internal types for the excel-grid library.
// Features: cell/coord/range models, change events, cell style model
// (bold/italic/underline/strike, font size, colors, alignment, wrapping,
// number formats, per-side borders, font family), full-state GridSnapshot
// (including merged ranges), component props and imperative handle types
// re-exported from src/index.ts.
// Recent changes: added GridSnapshot (cells + styles + colWidths) with the
// initialState prop, onStateChange prop (fires on every store mutation,
// including style-only and width-only edits), getSnapshot() on the handle,
// and a display field on getData() entries — all additive, for host-app
// persistence such as the demo's localStorage autosave. Added XlsxSheet
// (name + GridSnapshot) for multi-sheet workbook read/write. Added
// CellStyle.border (per-side thin/medium/thick + color) and
// CellStyle.fontFamily, and GridSnapshot.merges (A1:B2-style range refs)
// for merged cells.

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
export type NumFmt =
  | "general"
  | "percent"
  | "thousands"
  | "number"
  | "currency"
  | "scientific"
  | "date"
  | "time"
  | "datetime"
  | "duration";

/** Horizontal cell alignment. */
export type HAlign = "left" | "center" | "right";

/** Vertical cell alignment. */
export type VAlign = "top" | "middle" | "bottom";

/** Border line thickness; solid lines only (no dashed/dotted/double). */
export type BorderLineStyle = "thin" | "medium" | "thick";

/** One side of a cell's border. */
export interface BorderSide {
  style: BorderLineStyle;
  /** Line color (CSS color); defaults to black when rendered if absent. */
  color?: string;
}

/** Per-side border spec for a cell; an absent side means "no border". */
export interface CellBorder {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
}

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
  /** Font family (bare name, e.g. "Arial"); default is the grid's stack. */
  fontFamily?: string;
  /** Text color (CSS color). */
  color?: string;
  /** Fill / background color (CSS color). */
  background?: string;
  align?: HAlign;
  valign?: VAlign;
  /** Word-wrap the cell text within the row height. */
  wrap?: boolean;
  numFmt?: NumFmt;
  /** Fixed decimal places for numeric display (0-10). */
  decimals?: number;
  /** Per-side borders. */
  border?: CellBorder;
}

/**
 * Serializable full-state snapshot of a grid: sparse cell raw text and
 * styles keyed by A1 reference, column widths keyed by zero-based column
 * index. Excludes view state (filters, hidden lines, frozen panes, search)
 * and undo history. JSON-safe: suitable for localStorage persistence.
 */
export interface GridSnapshot {
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
  /** Merged ranges as "A1:B2"-style refs. */
  merges?: string[];
}

/** One named sheet of a multi-sheet workbook (see workbookToXlsx/xlsxToWorkbook). */
export interface XlsxSheet {
  name: string;
  snapshot: GridSnapshot;
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
  /** Full-state snapshot applied at mount (after initialCells). */
  initialState?: GridSnapshot;
  /** Called after each committed change batch (edit, paste, clear, fill, undo, redo). */
  onChange?: (changes: GridChange[]) => void;
  /**
   * Called after every grid state mutation, including style-only and
   * column-width-only edits that onChange does not report. Intended for
   * host-app persistence (debounce + getSnapshot()).
   */
  onStateChange?: () => void;
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
  /** All non-empty cells as { ref, raw, value, display (format-aware text) }. */
  getData(): Array<{ ref: string; raw: string; value: CellValue; display: string }>;
  /** Serializable full grid state (cells + styles + column widths). */
  getSnapshot(): GridSnapshot;
}
