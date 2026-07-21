# Requirement: Multi-sheet support for .xlsx files

## Problem

The xlsx read/write layer (`src/utils/xlsx.ts`) only handles one worksheet: `snapshotToXlsx()` always writes a single sheet named `"Sheet1"` (or `opts.sheetName`), and `xlsxToSnapshot()` only reads the first `<sheet>` in the workbook, silently discarding every other sheet. The core data model (`GridSnapshot` in `src/types.ts`) and the live grid (`GridStore`/`ExcelGrid`) represent exactly one sheet, and the demo app (`demo/main.tsx`) persists exactly one `GridSnapshot` per file.

As a result, opening a real-world multi-tab workbook loses all sheets but the first, and there is no way to save a grid with more than one sheet as `.xlsx`. Users working with typical Excel files (which very often have multiple tabs) cannot round-trip their data through this app without data loss.

## Requirement

Add multi-sheet support to the xlsx import/export path and to the demo app that exercises it:

1. The library must be able to serialize multiple named sheets (each an existing `GridSnapshot`) into one `.xlsx` workbook, and parse an `.xlsx` workbook's sheets (name + `GridSnapshot`) back out, in workbook order.
2. Existing single-sheet `snapshotToXlsx`/`xlsxToSnapshot` APIs keep working unchanged for existing callers (implemented on top of the new multi-sheet functions).
3. The demo app must let a user see all sheets in an opened workbook (not just the first), switch between them, add a new sheet, rename a sheet, and delete a sheet, and must save all sheets back out to `.xlsx`.
4. The demo's localStorage autosave must persist all sheets of the current document, not just one, and restore them (with the previously active sheet) on reload.

## Acceptance Criteria

- [x] A new library function serializes an ordered list of `{ name, snapshot }` sheets into one `.xlsx` file; opening the result in Excel/LibreOffice (or re-parsing it) shows every sheet, in order, with its given name. Evidence: `workbookToXlsx()` in [xlsx.ts:401](../../../../src/utils/xlsx.ts); round-trip test `xlsx.test.ts:267`.
- [x] A new library function parses an `.xlsx` file with N sheets into an ordered list of `{ name, snapshot }` covering all N sheets (not just the first), preserving each sheet's cells, styles, column widths, and row heights per existing single-sheet fidelity. Evidence: `xlsxToWorkbook()` in [xlsx.ts:765](../../../../src/utils/xlsx.ts); style-isolation test `xlsx.test.ts:283`.
- [x] `snapshotToXlsx` and `xlsxToSnapshot` remain exported with their current signatures and behavior (single-sheet in, single-sheet/first-sheet out) for backward compatibility. Evidence: thin wrappers at `xlsx.ts:489` and `xlsx.ts:837`; equivalence test `xlsx.test.ts:295`.
- [x] Round-tripping a multi-sheet workbook (write then read, or read a hand-crafted multi-sheet fixture) preserves sheet count, sheet names, and each sheet's cell/style content. Evidence: `xlsx.test.ts:264-305`, 3-sheet fixture with distinct names/content/styles.
- [x] The demo app's Open… action loads every sheet from an opened `.xlsx` file (or wraps a CSV/blank document as a single sheet) and displays a sheet-tab UI listing all sheet names. Evidence: `openFile()` in `demo/main.tsx:248`; tab UI at `demo/main.tsx:378`; manual browser walkthrough.
- [x] The demo app lets the user switch the active sheet via the tab UI, and the grid shown reflects that sheet's content. Evidence: `switchSheet()` at `demo/main.tsx:208`; verified in browser (tab highlight + content swap on click).
- [x] The demo app lets the user add a new (blank) sheet, rename an existing sheet, and delete a sheet (with at least one sheet always remaining), all via the tab UI. Evidence: `addSheet`/`renameSheet`/`deleteSheet` at `demo/main.tsx:216-244`; add/delete verified live in browser (localStorage inspection after deleting a lower-indexed sheet).
- [x] The demo app's Save XLSX action writes all current sheets (in tab order) to the downloaded `.xlsx` file. Evidence: `saveXLSX()` at `demo/main.tsx:302`, calling `workbookToXlsx(flushedSheets())`; clicked with no console/server errors in browser check.
- [x] The demo app's localStorage autosave persists all sheets and the active sheet index/name for the current file, and reloading the page restores the same sheets, content, and active sheet. Evidence: `persistSheets()`/`loadInitialDoc()` at `demo/main.tsx:141,73`; all four sheet-management actions call `persistSheets` directly (CR-fixed); verified live — deleted Sheet1 while Sheet3 active, localStorage showed `{"activeIndex":1,"sheets":["Sheet2","Sheet3"]}`, and a page reload restored the same state.
- [x] Existing single-sheet xlsx/CSV/persistence unit tests continue to pass unmodified (or are updated only where their assertions are inherently about the now-multi-sheet-aware format). Evidence: `npm test` — 13 files, 193 tests, all passing; `npx tsc --noEmit` clean.

## Constraints

- No new runtime dependencies (project is zero-dependency; keep using the existing `zip.ts`/DOMParser-based approach).
- Must keep `GridSnapshot` as the per-sheet shape; do not redefine it to embed multiple sheets.
- `ExcelGrid`/`GridStore` remain single-sheet components; multi-sheet orchestration lives above them (xlsx utils + demo app), not inside `GridStore`.
- Existing `.xlsx` files produced by this app (and by Excel/LibreOffice generally) must remain readable; sheet visibility/state (hidden sheets, active-tab flag in the workbook XML) can be ignored — read all sheets present regardless of visibility.
- CSV import/export stays single-table (CSV has no native multi-sheet concept); importing a CSV creates a document with exactly one sheet.

## Non-Goals

- No per-sheet freeze panes, tab color, or other Excel workbook-level metadata beyond sheet name/order.
- No drag-to-reorder sheet tabs (not required by acceptance criteria; can be a future enhancement).
- No cross-sheet formula reference support (e.g. `=Sheet2!A1`) — out of scope for this story; formulas continue to evaluate within their own sheet only.
- No changes to the CSV format itself.

## Open Questions

None — scope and API surface are unambiguous from the existing single-sheet implementation.
