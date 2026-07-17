# REQ: excel-grid-library

## Problem

Applications at the company need a spreadsheet-like data grid with familiar Excel / Google Sheets interactions (cell editing, formulas, keyboard navigation, copy/paste). No shared in-house component exists, so each app either embeds a heavyweight third-party dependency or builds ad-hoc tables without spreadsheet semantics. A reusable React component library that ships an Excel-style grid removes that duplication.

## Requirement

Produce an installable React component library (npm-package layout) whose primary export is an `ExcelGrid` React component that behaves like the web versions of Excel / Google Sheets for core spreadsheet interactions:

1. **Grid chrome**: lettered column headers (A, B, …, Z, AA, …), numbered row headers, a "select all" corner, and a formula bar showing the active cell's reference and raw content.
2. **Virtualized rendering**: only visible rows/columns are mounted so grids of at least 10,000 × 100 cells scroll smoothly.
3. **Selection**: single-cell click selection, range selection via drag and Shift+click/Shift+arrows, whole row/column selection via header click, Ctrl/Cmd+A select all. Active cell + selection range visually distinct.
4. **Keyboard navigation**: Arrow keys, Tab/Shift+Tab, Enter/Shift+Enter, Home, Ctrl/Cmd+Home, Page Up/Down move the active cell like Excel Web.
5. **Editing**: double-click or F2 opens the cell editor; typing on a selected cell starts a new edit replacing content; Enter commits and moves down; Tab commits and moves right; Escape cancels; Delete/Backspace clears selected cells. The formula bar edits the active cell too.
6. **Formulas**: values starting with `=` are evaluated. Supported: numbers, strings, booleans, cell references (`A1`), ranges (`A1:B3`), operators `+ - * / ^ % & = <> < <= > >=`, parentheses, and functions `SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ROUND, ABS, CONCATENATE, AND, OR, NOT`. Dependent cells recalculate automatically when a referenced cell changes. Circular references produce `#CYCLE!`; other evaluation failures produce Excel-style errors (`#NAME?`, `#VALUE!`, `#DIV/0!`, `#REF!`).
7. **Copy / paste**: Ctrl/Cmd+C copies the selection as TSV (interoperable with Excel/Sheets); Ctrl/Cmd+V pastes TSV into the grid starting at the active cell; Ctrl/Cmd+X cuts. Pasted/copied formulas adjust relative references by the paste offset.
8. **Undo / redo**: Ctrl/Cmd+Z and Ctrl/Cmd+Y (or Shift+Ctrl/Cmd+Z) undo/redo edits, pastes, clears, and fills.
9. **Column resize**: dragging a column header edge resizes that column; double-border hit area shows a resize cursor.
10. **Fill handle**: dragging the small square at the selection's bottom-right corner fills the dragged range by repeating the source values/formulas with relative-reference adjustment.
11. **Library API**: package exports `ExcelGrid`, TypeScript types for cell data and props, and supports: initial data injection, controlled row/column counts, an `onChange`-style callback with changed cells, and a ref-based imperative API to get/set cell values. Ships ESM + CJS bundles and `.d.ts` typings; React is a peer dependency.
12. **Demo app**: a runnable local demo page that mounts the grid with sample data for manual and E2E verification.

## Acceptance Criteria

- [ ] `npm run build` produces ESM + CJS bundles and TypeScript declarations under `dist/`, with React as a peer dependency (not bundled).
- [ ] Demo app runs locally and renders a grid ≥ 10,000 rows × 100 columns with headers, formula bar, and smooth scrolling (only visible cells in the DOM).
- [ ] Clicking a cell selects it; dragging selects a range; Shift+arrow extends the selection; header clicks select whole rows/columns; the formula bar shows the active cell reference.
- [ ] Arrow/Tab/Enter/Home/Ctrl+Home navigation moves the active cell per Excel Web conventions.
- [ ] Double-click, F2, and type-to-edit open the editor; Enter/Tab commit with Excel-style movement; Escape cancels; Delete clears the selection.
- [ ] Entering `=SUM(A1:A3)` (and other listed functions/operators) shows the computed value in the cell and the raw formula in the formula bar; editing a referenced cell recalculates dependents; a self-referencing formula shows `#CYCLE!`; `=1/0` shows `#DIV/0!`; an unknown function shows `#NAME?`.
- [ ] Copying a range and pasting it elsewhere adjusts relative cell references by the offset; TSV round-trips through the system clipboard.
- [ ] Undo reverts the latest edit/paste/clear/fill; redo reapplies it.
- [ ] Dragging a column header edge changes that column's width.
- [ ] Dragging the fill handle down/right fills cells from the source values/formulas with adjusted references.
- [ ] Unit tests cover cell-reference utilities, the formula parser/evaluator (each supported function/operator and each error case), reference adjustment, and TSV serialization — all passing.
- [ ] Public API is typed: consuming code can `import { ExcelGrid } from "<package>"` and receive full TypeScript types.

## Constraints

- React 18+ function components; TypeScript throughout; React and ReactDOM are peer dependencies.
- No runtime dependencies for the grid itself beyond React (no ag-grid/handsontable/formula.js style libraries); dev/build tooling is unrestricted.
- DOM-based rendering (no canvas) so consumers can style via CSS and accessibility hooks remain possible.
- Virtualization must keep interaction responsive at 10,000 × 100; no rendering of all cells.
- Clipboard integration must work in modern Chromium-based browsers; degrade gracefully (in-app copy/paste still works) where the async Clipboard API is unavailable.
- Styles ship with the library (single CSS file or injected styles) and must not leak global selectors beyond a namespaced class prefix.

## Non-Goals

- Cell formatting UI (bold/italic/colors/number formats), merged cells, frozen panes, row resize, sorting, filtering, multi-sheet workbooks, collaborative editing, import/export of `.xlsx` files.
- Full Excel formula-language parity (array formulas, absolute `$A$1` anchoring semantics beyond parsing, cross-sheet references, volatile functions like NOW).
- Server-side data loading, infinite remote scrolling, or state persistence.
- Publishing to a registry; the deliverable is the buildable package, not the npm publish step.
- Touch/mobile-specific gestures.
