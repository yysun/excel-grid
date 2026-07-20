# Done: toolbar search box

## Summary

- Added a live text search box to `Toolbar`, right-aligned via `margin-left:
  auto` on a new `.xg-tb-search` group placed after the Sum button.
- Search state (`searchQuery`, `searchScope`, `searchCols`) lives in
  `GridStore` as view state (not undoable), following the exact shape of
  the existing `filterCols`/`colFilters` → `filteredRows` pattern: a new
  `searchHiddenRows` derived set is recomputed in `notify()` and folded
  into `isRowHidden()` alongside manual hides and column filters.
- Matching is case-insensitive substring search against `getDisplay()`
  (the formatted on-screen text, not raw formula text), scoped to either
  every used-range column ("All columns") or an explicit column set
  ("Selected columns") that `Toolbar` keeps live via a `useEffect` on
  `selRange` — no re-typing needed when the selection changes.
- `ExcelGrid.renderCells` highlights matches by wrapping them in `<mark
  className="xg-search-hit">`, gated behind a new O(1)
  `GridStore.isCellMatched(row, col)` lookup so non-matching cells pay no
  extra render cost.
- New file: `src/state/GridStore.search.test.ts` (14 tests: row
  hiding/case-insensitivity/display-vs-raw matching, blank query, no-match
  query, empty sheet, edit-time re-evaluation, `isCellMatched`, both scope
  modes including out-of-range/empty column sets, and composition with
  `colFilters`).

## Verification

- `npm test` (`vitest run`): 152/152 passed (10 files, including the 14 new
  search tests).
- `npm run typecheck` (`tsc --noEmit`): clean.
- `npm run build` (`vite build`): clean, `dist/styles.css` and
  `dist/index.{js,cjs}` built successfully.
- Manual E2E against the demo app (`npm run dev`), recorded in
  [test-toolbar-search.md](../../../tests/test-toolbar-search.md):
  right-aligned search box; live row filtering while typing; cross-column
  highlight rendering; "Selected columns" scope narrowing matches to a
  chosen column and excluding matches elsewhere; clearing the query
  restores all rows with no leftover highlights; editing a cell while a
  query is active immediately updates that row's visibility (verified by
  editing a matching cell's text and watching its row disappear from the
  filtered view, then undoing).
- AR: reviewed REQ/AP together before implementation; found and fixed a
  gap (missing E2E spec, despite a clear repo precedent for this kind of
  UI feature) before proceeding to `SS`.

## Notes

- Search-vs-column-filter composition (REQ criterion: a row must pass both
  to show) is verified via unit tests rather than manual UI clicking,
  since precisely reproducing a specific filter+search combination through
  browser automation proved unreliable — the store-level logic both the UI
  paths depend on is directly covered by
  `GridStore.search.test.ts`'s "interaction with column filters" tests.
- No regex/wildcard syntax, find/replace navigation, or cross-remount
  persistence — all explicitly out of scope per the REQ's Non-Goals.
