// Public entry point of excel-grid.
// Features: exports the ExcelGrid component, its prop/handle/data types, and
// A1-reference helpers useful to consumers. Importing this module also pulls
// in the namespaced stylesheet (bundled to dist/styles.css).
// Recent changes: initial implementation.

import "./styles.css";

export { ExcelGrid } from "./components/ExcelGrid";
export type {
  CellCoord,
  CellData,
  CellRange,
  CellValue,
  ExcelGridHandle,
  ExcelGridProps,
  GridChange,
} from "./types";
export {
  colToLetters,
  lettersToCol,
  formatCellRef,
  parseCellRef,
  parseRange,
} from "./utils/cellRef";
