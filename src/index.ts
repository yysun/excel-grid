// Public entry point of excel-grid.
// Features: exports the ExcelGrid component, its prop/handle/data types, and
// A1-reference helpers useful to consumers. Importing this module also pulls
// in the namespaced stylesheet (bundled to dist/styles.css).
// Recent changes: exported GridSnapshot (full-state persistence snapshot)
// and the CSV helpers toCSV/parseCSV for host-app file import/export.

import "./styles.css";

export { ExcelGrid } from "./components/ExcelGrid";
export type {
  CellCoord,
  CellData,
  CellRange,
  CellStyle,
  CellValue,
  ExcelGridHandle,
  ExcelGridProps,
  GridChange,
  GridSnapshot,
  HAlign,
  NumFmt,
  VAlign,
} from "./types";
export {
  colToLetters,
  lettersToCol,
  formatCellRef,
  parseCellRef,
  parseRange,
} from "./utils/cellRef";
export { toCSV, parseCSV } from "./utils/tsv";
