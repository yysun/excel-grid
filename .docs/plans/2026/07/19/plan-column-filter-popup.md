# Plan: column-filter-popup

## Goal

The toolbar Filter button must toggle Excel-style per-column filter buttons
on the selected columns, each opening a multi-value checkbox popup, with the
GridStore filter model upgraded from a single value-match filter to
AND-combined per-column value-set filters (see req-column-filter-popup).

## Current Context

- `src/state/GridStore.ts` — `filteredRows: Set<number>` holds filter-hidden
  rows; `filterByValue(col, row)` / `clearFilter()` / `hasFilter()` are the
  whole filter API. `filteredRows` participates in `SheetSnapshot`,
  `remapAxis` (row remap), `restoreSheet`, and `sheetSnapshotsEqual`.
  `isRowHidden` unions `hiddenRows` and `filteredRows`. Data changes flow
  through `setCells` / `applyPatchBatch` / `remapAxis`, all ending in
  `notify(...)`.
- `src/components/Toolbar.tsx` — `toggleFilter()` calls
  `filterByValue(active.col, active.row)` or `clearFilter()`; the Filter
  button's `on` state is `store.hasFilter()`.
- `src/components/ExcelGrid.tsx` — `colHeaderCell(col)` renders lettered
  headers with a hover `xg-header-sort` button; the same function renders
  the frozen-column header copies. The cell context menu has "Filter by
  cell value" and "Clear filter" items (~line 883). `MenuState`-style local
  popup state and outside-mousedown close conventions already exist
  (Toolbar popovers, ContextMenu).
- `src/styles.css` — `xg-header-sort` (hover-reveal), `xg-tb-pop`,
  `xg-tb-menu*` popover styles to pattern-match.
- Tests: `src/state/GridStore.structure.test.ts` etc. run under vitest
  (`npm run test`); `npm run typecheck`; build via `npm run build`.
- Unknown resolved during discovery: filter re-evaluation must hook the
  three mutation paths that end in `notify`, or be recomputed inside
  `notify` itself when any column filter is active (chosen; see Decisions).

## Decisions

- **Filter model**: `filterCols: Set<number>` (columns showing a filter
  button) + `colFilters: Map<number, Set<string>>` (per-column allowed
  value keys; a column absent from the map filters nothing). `filteredRows`
  becomes a derived cache recomputed by `recomputeFilteredRows()`.
- **Value keys**: canonical string of the computed value — `""` for
  blank/null, `String(value)` otherwise (numbers via String, booleans
  "TRUE"/"FALSE" to match display). Exposed by a small
  `filterValueKey(value)` helper so store and popup agree. Comparison uses
  computed values, not styled display.
- **Re-evaluation on edit**: call `recomputeFilteredRows()` at the top of
  `notify()` when `colFilters.size > 0 || filteredRows.size > 0`. The
  second clause makes clearing the last filter unhide its rows (the clear
  methods empty `colFilters` before notify; a bare `size > 0` guard would
  leave `filteredRows` stale). This covers setCells, undo/redo, and
  structural edits with one hook and no extra notification loop.
- **Snapshot membership**: `filterCols` / `colFilters` REPLACE
  `filteredRows` in `SheetSnapshot` (snapshot the inputs, not the derived
  cache): `remapAxis` remaps them into the `after` snapshot for
  `axis === "col"` exactly like `hiddenCols`, `restoreSheet` restores
  them, and `sheetSnapshotsEqual` compares them. This keeps filter
  buttons attached to the right columns across structural undo/redo —
  matching how `hiddenCols` behaves today — while ordinary filter changes
  remain non-undoable view state (nothing pushes filter-only patches).
  `filteredRows` is derived-only and never snapshotted; the
  notify-recompute rebuilds it after any restore.
- **API**: replace `filterByValue`/`clearFilter` with:
  - `setFilterCols(cols: number[])`, `clearFilterCols()` (also clears
    `colFilters`), `getFilterCols(): Set<number>` (or `isFilterCol(col)`),
  - `setColFilter(col, allowed: Set<string> | null)` (null/full-set clears
    that column's filter; auto-adds `col` to `filterCols`),
  - `getColFilter(col): Set<string> | null`,
  - `getColumnValues(col): { key: string; label: string; count: number }[]`
    distinct used-range values sorted with the existing
    `compareCellValues` ordering, blanks last,
  - `hasFilter()` retained: true when `filterCols.size > 0` (drives the
    toolbar pressed state),
  - `hasActiveFilters()`: true when `colFilters.size > 0` (drives the
    context-menu "Clear filter" disabled state — `hasFilter()` would
    wrongly stay true when buttons exist but nothing is filtered),
  - context-menu "Filter by cell value" reimplemented as
    `setColFilter(col, new Set([keyOfActiveCell]))`;
    "Clear filter" calls a new `clearColFilters()` (filters cleared,
    buttons stay).
- **Snapshot copying**: `colFilters` is a `Map<number, Set<string>>` — in
  `remapAxis` it follows the `colWidths` Map-remap pattern (not the Set
  pattern), and `snapshotSheet`/`restoreSheet`/snapshot init must
  deep-copy the inner Sets; `sheetSnapshotsEqual` needs a Map-of-Sets
  comparator. Aliasing inner Sets across snapshots would corrupt undo.
- **Popup ownership**: the filter popup is a new
  `src/components/FilterPopup.tsx` rendered by `ExcelGrid` (not inside the
  virtualized header cell) with fixed positioning from the clicked button's
  `getBoundingClientRect()`, mirroring ContextMenu's fixed-position +
  outside-mousedown-close pattern. Local component state holds the draft
  checked set; OK commits to the store, Cancel/outside/Escape discards.
- **Rejected**: undo integration for filters (REQ non-goal); adding filter
  state to SheetSnapshot (would silently make filters undoable);
  per-cell display-string keying (breaks "same value, different numFmt is
  one entry"); rendering the popup inside the header strip (clipped by
  overflow, duplicated in frozen pane); feature flags/props to opt out
  (unnecessary).

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect `GridStore.ts` filter/remap/notify paths to confirm the
      derived-`filteredRows` + `notify`-hook design (done during AP; noted
      in Current Context).
- [x] Confirm `colHeaderCell` renders both scrolling and frozen header
      copies, so a popup anchored via `getBoundingClientRect` works for
      both (done during AP).
- [x] Record non-goals: no undo, no header-row exclusion, no condition
      filters, no popup sort controls (in REQ).

### Phase 2 - GridStore filter model

- [x] In `src/state/GridStore.ts`, add `filterCols`/`colFilters` state, the
      `filterValueKey` helper (exported), and `recomputeFilteredRows()`
      that rebuilds `filteredRows` from `colFilters` over the used range
      (row hidden when any filtered column's key ∉ allowed set).
- [x] Replace `filterByValue`/`clearFilter` with the new API
      (`setFilterCols`, `clearFilterCols`, `clearColFilters`,
      `setColFilter`, `getColFilter`, `isFilterCol`, `getFilterCols`,
      `getColumnValues`, updated `hasFilter`, new
      `hasActiveColFilter(col)`), each ending in `notify([])`.
- [x] Hook `recomputeFilteredRows()` into `notify()` (guarded by
      `colFilters.size > 0 || filteredRows.size > 0`) so setCells,
      undo/redo, structural edits, AND clearing the last filter all keep
      row visibility correct.
- [x] Replace `filteredRows` with `filterCols` + `colFilters` in
      `SheetSnapshot`, `snapshotSheet`, `restoreSheet`, and
      `sheetSnapshotsEqual`; in `remapAxis` build the `after` snapshot's
      `filterCols`/`colFilters` for `axis === "col"` (same pattern as
      `hiddenCols`) and carry them unchanged for `axis === "row"` (the
      notify-recompute re-derives row visibility).
- [x] Update the GridStore top comment block for the new filter layer.

### Phase 3 - Toolbar toggle and context menu rewire

- [x] In `src/components/Toolbar.tsx`, change `toggleFilter` to:
      `hasFilter() ? store.clearFilterCols() : store.setFilterCols(range
      of selRange.startCol..endCol)`; pressed state stays
      `store.hasFilter()`. Update the file comment block.
- [x] In `src/components/ExcelGrid.tsx`, rewire the cell context menu:
      "Filter by cell value" → `store.setColFilter(active.col,
      new Set([filterValueKey(value at active cell)]))`; "Clear filter" →
      `store.clearColFilters()` with `disabled: !store.hasActiveFilters()`.

### Phase 4 - Header filter buttons and FilterPopup component

- [x] Create `src/components/FilterPopup.tsx`: props
      `{ store, col, anchor: {x, y}, onClose }`; loads
      `store.getColumnValues(col)` + `getColFilter(col)` into draft state;
      renders search input, "Select all" tri-state control, scrollable
      checkbox list with "(Blanks)" label for the `""` key, OK / Cancel
      buttons; commits via `setColFilter` (full selection commits `null`);
      closes on outside mousedown and Escape; `onMouseDown` preventDefault
      except on the search input so grid focus is preserved.
- [x] In `ExcelGrid.tsx` `colHeaderCell`, render an `xg-header-filter`
      button when `store.isFilterCol(col)` (always visible, unlike the
      hover sort button; `--on` modifier when `hasActiveColFilter(col)`),
      opening the popup with the button's bounding rect; add
      `filterPopup: {col, x, y} | null` state and render `<FilterPopup>`
      near the ContextMenu render site. Update the file comment block.
- [x] In `src/styles.css`, add `.xg-header-filter` (funnel button, active
      state) and `.xg-filter-pop*` styles (fixed popup, search box, list,
      footer buttons) following `xg-tb-pop` / `xg-menu` conventions; keep
      the sort button from overlapping (shift sort button left when the
      filter button is present). Update the CSS comment header.

### Phase 5 - Tests and verification wiring

- [x] Add `src/state/GridStore.filter.test.ts` covering: setFilterCols /
      clearFilterCols toggle; setColFilter hides only non-matching rows;
      AND across two columns; blanks key ""; getColumnValues distinct +
      sorted + blank-last; re-evaluation after setCells edit; select-all
      commit clears the column filter; column insert/delete remaps
      filterCols and colFilters; structural-edit undo restores
      filterCols/colFilters to pre-edit columns; clearColFilters restores
      rows but keeps filterCols; clearing the last filter unhides its rows.
- [x] Rewrite the `filterByValue`/`clearFilter` test in
      `src/state/GridStore.structure.test.ts` (lines ~160–177) against the
      new `setColFilter`/`clearColFilters` API so no reference to the
      removed methods survives.
- [x] Run `npm run typecheck` and `npm run test`; record both outputs.
- [x] Verify `filterByValue` has no remaining references
      (`grep -rn "filterByValue" src demo`) so the legacy single-value
      filter is fully removed.

### Phase 6 - E2E and documentation

- [x] Execute `.docs/tests/test-column-filter-popup.md` scenarios against
      the dev server (`npm run dev`, port from demo/vite.config.ts) with
      browser tools; record evidence.
- [x] Run `npm run build`; record output.
- [x] Update `.docs/done/2026/07/19/column-filter-popup.md` via DD after
      commit.

## Validation

- `npm run typecheck` → exits 0.
- `npm run test` → all vitest suites pass, including the new
  `GridStore.filter.test.ts`.
- `npm run build` → library build succeeds.
- E2E (browser, demo app): scenarios in
  `.docs/tests/test-column-filter-popup.md` — toolbar toggle shows/hides
  header filter buttons, popup value list correctness, multi-value
  uncheck hides rows, AND across columns, select-all restore, search
  narrowing, active-button highlight, context-menu filter-by-value.
- Evidence to report: command outputs, and screenshots/read_page results
  for the E2E pass.

## Rollback / Risk

- `filteredRows` recompute inside `notify()` runs per mutation over the
  used range × filtered columns; acceptable for the existing 1000×26
  default but worth a cheap guard (skip when `colFilters` empty — planned).
- Removing `filterByValue`/`clearFilter` changes the store's public
  surface; grep confirms all callers (Toolbar, ExcelGrid context menu) are
  updated in this story. `src/index.ts` exports must be checked for
  re-exports of removed symbols.
- `SheetSnapshot` shape change (`filteredRows` → `filterCols`/`colFilters`)
  touches structural undo; the structure test suite plus the new filter
  tests cover snapshot round-trips. Snapshots only live in memory, so no
  serialized-format concern.
- Rollback: revert the single commit; filter state is in-memory view
  state, so no data/migration concerns.
