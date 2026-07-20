# Plan: toolbar search box

## Goal

Implement live, highlighted text search in `Toolbar`, filtering grid rows
via `GridStore`'s existing hidden-row pipeline and scoped to either all
columns or the current selection's columns, per
[req-toolbar-search.md](../../../reqs/2026/07/20/req-toolbar-search.md).

## Current Context

- `GridStore` (`src/state/GridStore.ts`) already has a precedent for
  derived, view-state row hiding: `filterCols`/`colFilters` →
  `filteredRows`, recomputed in `notify()` only when relevant state is
  non-empty, and consumed by `isRowHidden()`. Search hiding should follow
  the identical shape as a sibling derived set, not a rewrite of
  `isRowHidden`.
- `getDisplay(row, col)` already renders the exact on-screen text
  (number/date formats applied), which is what search must match against.
- `getUsedRange()` gives the occupied bounding box; iterating
  `getAllCells()` gives only non-empty cells directly (cheaper than
  scanning the full used-range rectangle when data is sparse). Matching
  should walk `getAllCells()` (or the used-range rectangle re-using
  `getDisplay`) rather than the full `rowCount × colCount` grid, per the
  REQ's responsiveness constraint.
- `Toolbar` (`src/components/Toolbar.tsx`) already receives `selRange` and
  `store` as props and has an existing pattern for "capture columns from
  the current selection" (`toggleFilter`'s cols loop). It re-renders
  whenever `ExcelGrid` re-renders (selection change, store version bump),
  so a `useEffect` keyed on `selRange`/scope can keep "selected columns"
  scope live without new coupling between `GridStore` and selection state.
- `ExcelGrid.renderCells` (`src/components/ExcelGrid.tsx`) is the single
  place cell text is rendered (`{display}`); this is where per-cell
  highlight markup must be injected, gated on a new `store.isCellMatched`
  check so non-matching renders pay no extra cost.
- `rowHeights` in `ExcelGrid` already computes `store.isRowHidden(i)` per
  row for the virtualization pass — no changes needed there since search
  hiding folds into `isRowHidden`.
- Styling conventions live in `src/styles.css` under `.xg-tb-*` (toolbar)
  and `.xg-filter-*` (existing search/list input in `FilterPopup`) — reuse
  `.xg-filter-search`-like input styling rather than inventing a new visual
  language.
- No search/highlight state exists today anywhere in the codebase.

## Decisions

- **Search state lives in `GridStore`**, as a third derived hidden-row set
  (`searchHiddenRows`) alongside `hiddenRows` and `filteredRows`, combined
  in `isRowHidden()`. Rejected: keeping search state in `ExcelGrid` React
  state and filtering rows at render time — would fork the hidden-row logic
  into two places and complicate the `rowHeights` virtualization memo.
- **Scope tracking is push-based from `Toolbar`, not GridStore-owned
  selection awareness.** `Toolbar` already receives `selRange`; a
  `useEffect` recomputes and pushes the explicit column list to
  `store.setSearchScope("selected", cols)` whenever `selRange` changes
  while scope is "selected". Rejected: passing `Selection` into `GridStore`
  — `GridStore` is explicitly framework/selection-agnostic today and this
  would be a new, unnecessary coupling.
- **Matching walks `getUsedRange()` rows × the scoped column list**, not
  `getAllCells()`, because "column contains match" must also correctly
  treat sparse gaps (an empty cell can't match, cheaply skipped by
  `getDisplay` returning `""`), and because "Selected columns" scope needs
  arbitrary column subsets that don't map cleanly onto per-cell iteration
  order. Bounded by used-range rows and the scope's column count, so it
  never touches the full `rows × cols` matrix.
- **No debounce.** `setSearchQuery` runs the recompute synchronously per
  keystroke, matching every other `GridStore` mutator (`setColWidth`,
  `setColFilter`, ...) which already recompute + notify per call. The
  bounded work in the previous bullet keeps this responsive at the demo
  dataset's scale; a debounce is unnecessary complexity absent a measured
  perf problem.
- **Highlighting is computed in `ExcelGrid.renderCells`**, gated by a new
  `GridStore.isCellMatched(row, col)` O(1) Set lookup, splitting the
  display string on case-insensitive query occurrences into `<mark>` spans.
  Rejected: storing pre-split React nodes in `GridStore` — the store must
  stay framework-agnostic (no JSX).
- **Explicitly rejected**: regex/wildcard syntax, find/replace navigation,
  persisting search across remounts, a feature flag to disable search, and
  debounce/throttle knobs — none required by the REQ, all called out as
  Non-Goals.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Confirm `GridStore.notify()`'s existing conditional-recompute pattern
      (`src/state/GridStore.ts` lines ~137-146) so the new search recompute
      follows the same "only recompute when there's something to compute or
      clear" shape as `recomputeFilteredRows`.
- [x] Confirm `isRowHidden` (line ~201) is the single call site consumed by
      `ExcelGrid`'s `rowHeights` memo (line ~155-161) and `hasHiddenRowsIn`
      is unrelated (manual-hide only) — search must not touch
      `hasHiddenRowsIn`/`setRowsHidden`.
- [x] Record non-goal: no changes to `filterCols`/`colFilters`/`FilterPopup`
      behavior — search composes with them only via `isRowHidden`.

### Phase 2 - GridStore: search state and derived matching

- [x] Add private fields to `GridStore`: `searchQuery = ""`,
      `searchScope: "all" | "selected" = "all"`,
      `searchCols: Set<number> | null = null`,
      `searchHiddenRows = new Set<number>()`,
      `searchMatchedCells = new Set<string>()`.
- [x] Add `setSearchQuery(query: string): void` — no-op if unchanged, else
      store and `notify([])` (view-state mutator, same shape as
      `setColWidth`).
- [x] Add `setSearchScope(scope: "all" | "selected", cols?: number[]): void`
      — sets `searchScope`; when `"selected"`, sets `searchCols` to
      `new Set(cols ?? [])`, else `null`; `notify([])`.
- [x] Add `getSearchQuery(): string`, `hasSearch(): boolean` (query trimmed
      non-empty), `isCellMatched(row, col): boolean` (checks
      `searchMatchedCells`).
- [x] Add private `recomputeSearch(): void`: clears
      `searchHiddenRows`/`searchMatchedCells`; if the trimmed query is
      empty or `getUsedRange()` is null, return; build the scoped column
      list (`searchScope === "selected" && searchCols` → filtered/clamped
      `searchCols`, else the full `[used.startCol..used.endCol]` range);
      if the column list is empty, return; for each row in
      `[used.startRow..used.endRow]`, for each scoped col, check
      `getDisplay(row, col).toLowerCase().includes(query)`, recording
      matched cell keys and marking the row unmatched (added to
      `searchHiddenRows`) only if no column in scope matched.
- [x] Wire `recomputeSearch()` into `notify()` beside the existing
      `recomputeFilteredRows()` call, gated so it only runs when there is
      an active query or stale search state to clear (mirrors the existing
      `colFilters.size > 0 || filteredRows.size > 0` guard).
- [x] Extend `isRowHidden(row)` to also check `searchHiddenRows.has(row)`.
- [x] Confirm `setColFilter`/`setCells`/structural edits — which already
      call `notify()` — pick up search recompute for free (no per-call-site
      changes needed beyond the `notify()` wiring above).

### Phase 3 - Toolbar: search input, scope control, right alignment

- [x] Add local `Toolbar` state: `const [query, setQuery] = useState("")`.
- [x] Add a right-aligned search group at the end of the toolbar's JSX
      (after the existing `Sum` button): a wrapper `div` with class
      `xg-tb-search` (styled `margin-left: auto` in CSS), containing:
      - a `<select>` (class `xg-tb-search-scope`) with options `All
        columns` (`value="all"`) / `Selected columns` (`value="selected"`),
        bound to local state `scope`.
      - a text `<input>` (class `xg-tb-search-input`, placeholder
        `"Search"`) bound to `query`, `onChange` updates local state and
        calls `store.setSearchQuery(value)`.
      - a clear button (×, class `xg-tb-search-clear`), rendered only when
        `query !== ""`, that resets `query` to `""` and calls
        `store.setSearchQuery("")`.
- [x] Add `const [scope, setScope] = useState<"all" | "selected">("all")`;
      on `<select>` change, update `scope` and immediately push the right
      value to the store (for `"all"`, `store.setSearchScope("all")`; for
      `"selected"`, compute cols from `selRange` inline).
- [x] Add a `useEffect` keyed on `[selRange, scope, store]`: when
      `scope === "selected"`, recompute the column list from
      `selRange.startCol..selRange.endCol` and call
      `store.setSearchScope("selected", cols)` — keeps scope live as the
      selection changes, per REQ.
- [x] Confirm the search group's `mousedown` isn't swallowed by the
      toolbar's existing root `onMouseDown={(e) => e.preventDefault()}`
      (`Toolbar.tsx` line ~224) in a way that breaks typing/focus — the
      input needs its own `onMouseDown={(e) => e.stopPropagation()}` (input
      focus must not be prevented) while the rest of the toolbar keeps
      `preventDefault` for grid-focus retention.

### Phase 4 - ExcelGrid: highlight matched text

- [x] Add a module-level helper `highlightMatches(text: string, query:
      string): React.ReactNode` in `ExcelGrid.tsx`: case-insensitive split
      of `text` on all occurrences of `query`, non-matching segments as
      plain strings, matching segments wrapped in `<mark
      className="xg-search-hit">`.
- [x] In `renderCells`, after computing `display`, check
      `store.hasSearch() && store.isCellMatched(row, col)`; when true,
      render `highlightMatches(display, store.getSearchQuery())` instead of
      the raw `display` string as the cell's children.
- [x] Confirm this doesn't change cell width/height layout (inline `<mark>`
      keeps text flow identical to a plain text node).

### Phase 5 - Styling

- [x] Add `.xg-tb-search` (flex row, `margin-left: auto`, `gap: 4px`,
      `align-items: center`) to `src/styles.css`, placed near the other
      `.xg-tb-*` rules.
- [x] Add `.xg-tb-search-input` (reuse `.xg-filter-search`'s sizing/border
      look, ~140px width), `.xg-tb-search-scope` (compact select styling
      consistent with toolbar buttons), `.xg-tb-search-clear` (small icon
      button, reuse `.xg-tb-btn`-like hover state).
- [x] Add `.xg-search-hit` (e.g. `background: #ffe066; border-radius: 2px;`
      — visible highlight, no layout shift) near the cell-related rules.

### Phase 6 - Tests and verification wiring

- [x] Add `src/state/GridStore.search.test.ts` covering: typing a query
      hides non-matching rows (`isRowHidden`) and leaves matching rows
      visible; case-insensitive matching against formatted display (e.g. a
      `percent`-formatted cell matches `"10%"` not the raw decimal);
      `"selected"` scope only matches within the given column set, ignoring
      matches in other columns; clearing the query (`setSearchQuery("")`)
      unhides all search-hidden rows; search composes with an active
      `colFilters` entry (row hidden by either stays hidden); editing a
      cell's raw value while a query is active changes its row's
      hidden/matched state on the next store change; `isCellMatched`
      reflects the correct matched cells for a query.
- [x] Run `npm test` (`vitest run` per `package.json`) and record a pass
      with the new file included.
- [x] Run `npm run typecheck` (`tsc --noEmit`) and `npm run build` (`vite
      build`) and record clean results.
- [x] Create `.docs/tests/test-toolbar-search.md`, following the format of
      the existing `.docs/tests/test-column-filter-popup.md` (run-against-
      demo-app preamble, numbered scenarios with steps + Expect lines):
      scenarios for (1) typing a query hides non-matching rows live and
      highlights matches, (2) clearing the box restores all rows and
      removes highlights, (3) switching scope to "Selected columns" after
      selecting a column range narrows matches to that range, (4) scope
      stays live as the selection is dragged/changed without retyping, (5)
      search composing with an active column filter (both must pass for a
      row to show), (6) editing a cell while a query is active updates its
      row's visibility/highlight.
- [x] Execute that spec against the demo app (`npm run dev`) and record the
      observed result for each scenario/step as evidence.

### Phase 7 - Documentation and status

- [x] Update the `Toolbar.tsx` top comment block (Features/Recent changes)
      to mention the right-aligned search box and scope control.
- [x] Update the `GridStore.ts` top comment block to mention search
      state/matching alongside the existing filter description.
- [x] Update the `ExcelGrid.tsx` top comment block's Recent changes to
      mention search-match highlighting in `renderCells`.
- [x] Record final evidence (test run output, build output, manual-check
      notes) showing every REQ acceptance criterion is satisfied.
- [x] Mark completed tasks complete only after the corresponding change or
      evidence exists.

## Validation

- Unit tests: new `src/state/GridStore.search.test.ts` plus the full
  existing suite must pass via `npm test` (`vitest run`).
- Typecheck/build: `npm run typecheck` (`tsc --noEmit`) and `npm run build`
  (`vite build`) must both run clean.
- E2E: `.docs/tests/test-toolbar-search.md`, a new markdown spec following
  the repo's existing convention (see `test-column-filter-popup.md`),
  executed by hand against the `demo/` app (`npm run dev`); results
  recorded as evidence in Phase 7.

## Rollback / Risk

- Low risk: additive `GridStore` fields/methods, additive `Toolbar` JSX,
  additive `ExcelGrid` render-time branch gated behind
  `store.hasSearch()`. No existing method signatures change; no existing
  state shape changes (search fields are new, independent of
  `hiddenRows`/`filterCols`/undo patches).
- Main risk is perf on very large sheets if a future consumer sets huge
  `rows`/`cols` with a fully dense used range — mitigated by scoping the
  scan to `getUsedRange()` rows × the scope's column list rather than the
  full grid, per the REQ constraint.
- Rollback is a straightforward revert of the four touched files (`
  GridStore.ts`, `Toolbar.tsx`, `ExcelGrid.tsx`, `styles.css`) plus deleting
  the new test file — no data migration, no persisted state involved.
