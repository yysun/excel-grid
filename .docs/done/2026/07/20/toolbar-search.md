# Done: toolbar search box

## Summary

- Added a live text search box to `Toolbar`, right-aligned via `margin-left:
  auto` on a new `.xg-tb-search` group placed after the Sum button. No
  separate scope control — search always matches against exactly the
  columns currently selected in the grid (`selRange.startCol..endCol`),
  live. Selecting a single cell scopes search to one column; selecting
  every column (e.g. select-all) searches the whole sheet. (An initial
  version added an "All columns" / "Selected columns" dropdown; removed
  per user feedback — "No need column dropdown, use the grid column
  selection" — before it was relied on elsewhere.)
- Search state (`searchQuery`, `searchCols`) lives in `GridStore` as view
  state (not undoable), following the exact shape of the existing
  `filterCols`/`colFilters` → `filteredRows` pattern: a new
  `searchHiddenRows` derived set is recomputed in `notify()` and folded
  into `isRowHidden()` alongside manual hides and column filters.
  `setSearchCols(cols: number[])` always pins matching to exactly the
  given columns — there is no "search everything" mode in the store
  itself; `Toolbar` pushes its live selection on every change.
- Matching is case-insensitive substring search against `getDisplay()`
  (the formatted on-screen text, not raw formula text).
- `ExcelGrid.renderCells` highlights matches by wrapping them in `<mark
  className="xg-search-hit">`, gated behind a new O(1)
  `GridStore.isCellMatched(row, col)` lookup so non-matching cells pay no
  extra render cost.
- `src/state/GridStore.search.test.ts` (16 tests): row hiding, case-
  insensitivity, display-vs-raw matching, blank query, no-match query,
  empty sheet, edit-time re-evaluation, `isCellMatched`, `setSearchCols`
  scoping (single column, every column, empty set, out-of-range columns,
  re-scoping live), the no-`setSearchCols`-call default (empty scope, no
  rows hidden), and composition with `colFilters`.

## Verification

- `npm test` (`vitest run`): 154/154 passed (10 files, including the 16
  search tests).
- `npm run typecheck` (`tsc --noEmit`): clean.
- `npm run build` (`vite build`): clean, `dist/styles.css` and
  `dist/index.{js,cjs}` built successfully.
- Manual E2E against the demo app (`npm run dev`), recorded in
  [test-toolbar-search.md](../../../tests/test-toolbar-search.md):
  right-aligned search box with no dropdown; a single-cell selection (the
  default) scopes search to one column; select-all widens matching to the
  whole sheet with cross-column highlighting; selecting a specific column
  header narrows matches and highlights to that column live, and
  re-selecting a different column re-scopes instantly with no retyping;
  clearing the query restores all rows with no leftover highlights;
  editing a matching cell's text while a query is active immediately drops
  its row from the filtered view (then undo restores it).
- AR: reviewed REQ/AP together before the initial implementation; found
  and fixed a gap (missing E2E spec, despite a clear repo precedent for
  this kind of UI feature) before proceeding to `SS`.

## Notes

- Search-vs-column-filter composition (REQ criterion: a row must pass both
  to show) is verified via unit tests rather than manual UI clicking,
  since precisely reproducing a specific filter+search combination through
  browser automation proved unreliable — the store-level logic both the UI
  paths depend on is directly covered by
  `GridStore.search.test.ts`'s "interaction with column filters" tests.
- No regex/wildcard syntax, find/replace navigation, or cross-remount
  persistence — all explicitly out of scope per the REQ's Non-Goals.
