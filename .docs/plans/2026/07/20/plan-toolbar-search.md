# Plan: toolbar search box

## Goal

Implement live, highlighted text search in `Toolbar`, filtering grid rows
via `GridStore`'s existing hidden-row pipeline and always scoped to the
grid's current selection's columns — no separate scope selector control —
per [req-toolbar-search.md](../../../reqs/2026/07/20/req-toolbar-search.md).

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
  so a `useEffect` keyed on `selRange` alone can keep the search column
  scope live without new coupling between `GridStore` and selection state
  and without a toolbar-local mode to track.
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
- **No scope selector UI; scope is always the grid's current selection**
  (correction from this plan's initial version, which added a toolbar
  `<select>` for "All columns" / "Selected columns" — removed per explicit
  user feedback: "No need column dropdown, use the grid column selection").
  `Toolbar` already receives `selRange` on every render; a `useEffect`
  pushes `[selRange.startCol..selRange.endCol]` to the store on every
  change, unconditionally (no scope state/toggle to gate it). Rejected
  (carried over from the original decision): passing `Selection` into
  `GridStore` itself — `GridStore` stays framework/selection-agnostic;
  `Toolbar` remains the sole pusher of the column list.
- **`GridStore`'s search-scope API drops the `"all" | "selected"` mode
  entirely** in favor of a single `setSearchCols(cols: number[]): void`
  that always pins matching to exactly the given columns. There is no
  "search everything regardless of selection" mode — searching the whole
  sheet is simply what happens when the caller's selection already spans
  every column (e.g. select-all), which requires no special-casing in the
  store. Rejected: keeping the `"all"` mode as a fallback for an empty/
  degenerate selection — the REQ is explicit that a single selected cell
  scoping search to one column is expected, not an edge case to paper
  over.
- **Matching walks `getUsedRange()` rows × the scoped column list**, not
  `getAllCells()`, because "column contains match" must also correctly
  treat sparse gaps (an empty cell can't match, cheaply skipped by
  `getDisplay` returning `""`), and because an arbitrary column subset
  doesn't map cleanly onto per-cell iteration order. Bounded by used-range
  rows and the scope's column count, so it never touches the full
  `rows × cols` matrix.
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
- **Explicitly rejected**: a scope selector control of any kind (see
  above), regex/wildcard syntax, find/replace navigation, persisting
  search across remounts, a feature flag to disable search, and
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
      `searchCols = new Set<number>()`, `searchHiddenRows = new
      Set<number>()`, `searchMatchedCells = new Set<string>()`. Remove the
      `searchScope: "all" | "selected"` field and the `SearchScope` type —
      there is no longer a mode to track, only the current column set.
- [x] Add `setSearchQuery(query: string): void` — no-op if unchanged, else
      store and `notify([])` (view-state mutator, same shape as
      `setColWidth`).
- [x] Replace `setSearchScope(scope, cols?)` with
      `setSearchCols(cols: number[]): void` — always sets `searchCols =
      new Set(cols)` (no mode branch) and `notify([])`. This is the only
      way the column scope changes; there is no "search all columns"
      entry point in the store itself.
- [x] Add `getSearchQuery(): string`, `hasSearch(): boolean` (query trimmed
      non-empty), `isCellMatched(row, col): boolean` (checks
      `searchMatchedCells`).
- [x] Update private `recomputeSearch(): void`: clears
      `searchHiddenRows`/`searchMatchedCells`; if the trimmed query is
      empty or `getUsedRange()` is null, return; build the scoped column
      list by filtering/clamping `searchCols` to `[0, colCount)` (no more
      "all used-range columns" branch — an empty/degenerate `searchCols`
      simply means nothing is in scope, matching the REQ's "single
      selected cell scopes to one column" expectation); if the column list
      is empty, return; for each row in `[used.startRow..used.endRow]`,
      for each scoped col, check
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
- [x] Update `src/state/GridStore.search.test.ts`: replace
      `setSearchScope("selected", cols)` / `setSearchScope("all")` calls
      with `setSearchCols(cols)`; replace the "an empty selected-column set
      has nothing to scan" test's setup accordingly; remove any assertions
      that depended on an `"all"` mode existing (e.g. "switching back to
      'all' re-widens matching" — replace with a test that calling
      `setSearchCols` with the full column range has the same widening
      effect).

### Phase 3 - Toolbar: search input, live selection-driven scope, right alignment

- [x] Add local `Toolbar` state: `const [query, setQuery] = useState("")`.
- [x] Remove the scope `<select>` (`xg-tb-search-scope`) and its local
      `scope` state entirely — the search group is now just the input +
      clear button, no mode picker.
- [x] Simplify the right-aligned search group at the end of the toolbar's
      JSX (after the existing `Sum` button) to a wrapper `div` with class
      `xg-tb-search` (still `margin-left: auto` in CSS), containing only:
      - a text `<input>` (class `xg-tb-search-input`, placeholder
        `"Search"`) bound to `query`, `onChange` updates local state and
        calls `store.setSearchQuery(value)`.
      - a clear button (×, class `xg-tb-search-clear`), rendered only when
        `query !== ""`, that resets `query` to `""` and calls
        `store.setSearchQuery("")`.
- [x] Replace the scope-toggle `useEffect` with one keyed on
      `[selRange, store]` that unconditionally computes
      `[selRange.startCol..selRange.endCol]` and calls
      `store.setSearchCols(cols)` on every change — this is the only path
      that ever updates the store's search columns; it runs regardless of
      whether a query is active, so the scope is always current by the
      time the user starts typing.
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
- [x] Remove the now-unused `.xg-tb-search-scope` rule (the `<select>` it
      styled no longer exists). Keep `.xg-tb-search-input` (reuse
      `.xg-filter-search`'s sizing/border look, ~140px width) and
      `.xg-tb-search-clear` (small icon button, reuse `.xg-tb-btn`-like
      hover state).
- [x] Add `.xg-search-hit` (e.g. `background: #ffe066; border-radius: 2px;`
      — visible highlight, no layout shift) near the cell-related rules.

### Phase 6 - Tests and verification wiring

- [x] Update `src/state/GridStore.search.test.ts` (see Phase 2's last task)
      so it covers: typing a query hides non-matching rows (`isRowHidden`)
      and leaves matching rows visible; case-insensitive matching against
      formatted display (e.g. a `percent`-formatted cell matches `"10%"`
      not the raw decimal); `setSearchCols` scopes matching to exactly the
      given column set, ignoring matches in other columns, including when
      that set covers every column (the "search everything" case) and when
      it's a single column; clearing the query (`setSearchQuery("")`)
      unhides all search-hidden rows; search composes with an active
      `colFilters` entry (row hidden by either stays hidden); editing a
      cell's raw value while a query is active changes its row's
      hidden/matched state on the next store change; `isCellMatched`
      reflects the correct matched cells for a query.
- [x] Run `npm test` (`vitest run` per `package.json`) and record a pass
      with the updated file included.
- [x] Run `npm run typecheck` (`tsc --noEmit`) and `npm run build` (`vite
      build`) and record clean results.
- [x] Update `.docs/tests/test-toolbar-search.md` (already created,
      following `.docs/tests/test-column-filter-popup.md`'s format) to
      remove the scope-dropdown scenario (previously Scenario 3/4) and
      replace it with scenarios that select specific columns in the grid
      directly (no dropdown) and confirm search scope narrows to exactly
      those columns, live, as the selection changes — keep the scenarios
      for live filtering, highlighting, clearing, column-filter
      composition, and edit-time re-evaluation, updated only where they
      referenced the removed dropdown.
- [x] Execute the updated spec against the demo app (`npm run dev`) and
      record the observed result for each scenario/step as evidence.

### Phase 7 - Documentation and status

- [x] Update the `Toolbar.tsx` top comment block (Features/Recent changes)
      to describe the right-aligned search box as always scoped to the
      grid's current selection (no scope control/dropdown).
- [x] Update the `GridStore.ts` top comment block to mention search
      state/matching alongside the existing filter description (already
      generic enough to not need scope-specific wording changes, but
      re-check once `setSearchScope` is renamed to `setSearchCols`).
- [x] Update the `ExcelGrid.tsx` top comment block's Recent changes to
      mention search-match highlighting in `renderCells` (unaffected by
      this change).
- [x] Record final evidence (test run output, build output, manual-check
      notes) showing every REQ acceptance criterion — including the
      corrected scope criterion — is satisfied.
- [x] Mark completed tasks complete only after the corresponding change or
      evidence exists.

## Validation

- Unit tests: updated `src/state/GridStore.search.test.ts` plus the full
  existing suite must pass via `npm test` (`vitest run`).
- Typecheck/build: `npm run typecheck` (`tsc --noEmit`) and `npm run build`
  (`vite build`) must both run clean.
- E2E: updated `.docs/tests/test-toolbar-search.md`, executed by hand
  against the `demo/` app (`npm run dev`); results recorded as evidence in
  Phase 7.

## Rollback / Risk

- Low risk: this correction narrows the already-shipped feature's public
  surface (`setSearchScope` → `setSearchCols`, one fewer toolbar control)
  rather than adding new architecture. No consumer outside this repo
  depends on `setSearchScope`/`SearchScope` yet (the feature shipped in
  the same story, not released).
- Main risk is perf on very large sheets if a future consumer sets huge
  `rows`/`cols` with a fully dense used range — mitigated by scoping the
  scan to `getUsedRange()` rows × the scoped column list rather than the
  full grid, per the REQ constraint. Unchanged by this correction.
- Rollback is a straightforward revert of the four touched files (`
  GridStore.ts`, `Toolbar.tsx`, `ExcelGrid.tsx`, `styles.css`) plus
  reverting the test file to its pre-correction state.
