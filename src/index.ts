// Public entry point of excel-grid.
// Features: exports the ExcelGrid component, its prop/handle/data types, and
// A1-reference helpers useful to consumers. Importing this module also pulls
// in the namespaced stylesheet (bundled to dist/styles.css).
// Recent changes: exported CellStyle/NumFmt/HAlign for the toolbar feature.

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
  HAlign,
  NumFmt,
} from "./types";
export {
  colToLetters,
  lettersToCol,
  formatCellRef,
  parseCellRef,
  parseRange,
} from "./utils/cellRef";
