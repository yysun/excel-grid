# Done: Multi-sheet support for .xlsx files

## Summary

- Added `workbookToXlsx(sheets: XlsxSheet[])` / `xlsxToWorkbook(bytes)` to `src/utils/xlsx.ts` — the xlsx reader/writer now handles every sheet in a workbook (previously only the first sheet was read, and only one sheet named `"Sheet1"` could be written).
- `snapshotToXlsx`/`xlsxToSnapshot` are now thin wrappers over the new workbook functions, preserving their exact single-sheet signature and behavior for existing callers.
- Style interning (fonts/fills/number formats) is now workbook-scoped so all sheets share one `styles.xml`, per the OOXML format.
- Added `XlsxSheet` (`{ name, snapshot }`) to `src/types.ts`, exported from `src/index.ts` alongside the two new functions.
- Demo app (`demo/main.tsx`) gained a sheet-tab row: switch, add, rename (prompt), and delete (confirm, blocked below 1 sheet) sheets. `DocState` changed from a single `GridSnapshot` to `{ sheets: XlsxSheet[], activeIndex }`; Open…/Save XLSX now round-trip all sheets; localStorage autosave persists all sheets and the active index.
- Updated README's xlsx export table and "Not (yet) included" list to reflect multi-sheet support.

## Verification

- `npm test` — 13 files, 193 tests, all passing (includes 3 new multi-sheet tests: order/name/content round-trip, per-sheet style isolation, single-sheet backward-compat equivalence).
- `npx tsc --noEmit` — clean.
- Independent architecture review (AR) of REQ+plan before implementation — passed, one minor doc clarification applied (empty-workbook error path).
- Independent code review (CR) of the diff — found and the primary agent fixed two bugs before this doc was written: (1) `deleteSheet` wasn't decrementing `activeIndex` when a lower-indexed sheet was removed, so the wrong sheet became active; (2) sheet add/rename/delete/switch never triggered autosave, so those actions were lost on reload unless followed by a cell edit. Both fixed via `cancelPendingSave()` + direct `persistSheets()` calls in all four sheet-management actions.
- Independent verification review (VR) — built an acceptance-criteria evidence matrix against the REQ; all 10 criteria complete, re-verified the two CR fixes are genuinely present (not just claimed).
- Manual browser walkthrough (dev server): added sheets, switched tabs, deleted a lower-indexed sheet while a higher one was active (confirmed via `localStorage` inspection that the correct sheet stayed active), reloaded the page and confirmed the same sheets/content/active-tab were restored, clicked Save XLSX with no console/server errors.

## Notes

- Direct cell-content typing into the canvas-rendered grid could not be exercised through the browser automation tool in this session (its synthetic key events aren't picked up by the grid's canvas input handling) — this is a pre-existing tool/component interaction, unrelated to this change. Cell-content fidelity through the xlsx read/write path is covered instead by the unit round-trip tests (existing single-sheet suite + new multi-sheet suite).
- Non-goals carried over from the REQ, not implemented: cross-sheet formula references (`=Sheet2!A1`), sheet-tab drag-to-reorder, per-sheet tab color/freeze-pane metadata.
- The demo's localStorage schema changed from a bare `GridSnapshot` to `{ sheets, activeIndex }`; old-format entries fail the new shape check and fall back to a blank single-sheet document (same fallback path as corrupt JSON) — no migration was implemented, matching the REQ's constraints (local dev demo, no compatibility requirement for old autosave entries).
