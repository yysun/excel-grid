# Plan: Context menus for rows, columns, and cells

Story: `context-menus` — created 2026-07-18. REQ:
`.docs/reqs/2026/07/18/req-context-menus.md`.

## Goal

Right-click anywhere in the grid opens a working context menu whose actions
(insert/delete/move/hide/freeze/sort/filter/clipboard) actually mutate or
re-present the sheet, with structural edits undoable and formulas rewritten.

## Current Context

- `src/state/GridStore.ts` — sparse `cells`/`styles` maps keyed `"row,col"`,
  undo/redo as `Patch[][]` (raw + style patches), `colWidths` map,
  `rowCount`/`colCount` fixed at construction, full dependency graph +
  `recompute`. No structural ops, no hidden/frozen state.
- `src/components/ExcelGrid.tsx` — virtualized rendering with **uniform row
  height** (`row * rowHeight` everywhere) and variable column widths via
  `buildColMetrics` prefix sums; selection, clipboard (native events +
  internal fallback + async-API fallback in Ctrl+V), fill handle, column
  resize; row/col header strips synced by `transform`.
- `src/components/useVirtualRange.ts` — window math; rows assume uniform
  height, cols use `ColMetrics` (offsets + `colAtX` binary search).
- `src/formula/adjust.ts` — `adjustFormula` rewrites relative refs via the
  tokenizer; the same token-walk pattern supports axis remapping.
- `src/utils/cellRef.ts` — key/ref helpers. `src/styles.css` — `.xg-*`
  namespace; popover styling precedent in `.xg-tb-pop`.
- Tests: vitest + jsdom; existing suites are store/util level
  (`GridStore.test.ts`, `GridStore.style.test.ts`, `formula.test.ts`,
  `cellRef.test.ts`, `tsv.test.ts`). Commands: `npm test`,
  `npm run typecheck`. Demo dev server: `npm run dev`
  (`.claude/launch.json` name available for browser E2E).
- Known unknowns: none blocking; frozen-pane hit-testing and header pinning
  are the riskiest rendering pieces (addressed in Phase 4).

## Decisions

- **One structural primitive**: `remapAxis(axis, map)` where
  `map(oldIndex) → newIndex | null` (null = dropped). Insert, delete, and
  move are all expressed as index mappings. It rebuilds `cells`, `styles`,
  `colWidths`, hidden sets through the map and rewrites every stored
  formula's refs on that axis via a new tokenizer-based
  `remapFormulaAxis` in `adjust.ts` (mapped-to-null refs → `#REF!`).
  Rejected: per-op ad-hoc shifting (three implementations of the same
  bug-prone remap).
- **Structural undo = sparse sheet snapshot**: a new `SheetPatch` on the
  existing undo stacks stores before/after copies of the sparse raw map,
  styles map, colWidths map, and hidden sets. Cost is O(occupied), matching
  the REQ constraint. Rejected: inverse-operation undo (deleting rows loses
  information that inverse insert cannot restore, e.g. `#REF!` rewrites).
- **Hidden = zero-size**: hidden rows/cols keep their indices; the component
  gives them zero height/width in the metrics prefix sums, so
  virtualization, hit-testing, and offsets all keep working unchanged.
  Rows move from `row * rowHeight` to a `rowMetrics` prefix-sum identical in
  shape to `ColMetrics` (generalized as `buildAxisMetrics`, keeping the
  `buildColMetrics` name as an alias is unnecessary — it is internal).
- **Filter is a second hidden set** (`filteredRows`) so Clear filter cannot
  un-hide manually hidden rows and vice versa; effective hidden =
  union. Filter/hide/freeze are view state, not undoable (REQ non-goal),
  but hidden sets are remapped by structural ops and included in
  `SheetPatch` so structural undo restores a consistent sheet.
- **Freeze = pane overlays**: `frozenRows`/`frozenCols` counts in the store.
  The body renders up to three absolutely-positioned overlay panes (top,
  left, corner) inside a new relative wrapper, each `overflow:hidden` with
  an inner layer counter-translated on one axis — the exact pattern the
  header strips already use. Frozen portions of the header strips get a
  non-translated second inner layer. Sheet coordinates are reused unchanged
  because frozen indices start at 0. Fill handle renders only in the main
  scrolling layer (accepted cosmetic limitation, REQ non-goal territory).
  Rejected: 4-way split scroll containers (large rewrite, scroll-sync jank).
- **Sort via `setCells`**: `sortRange` computes a row permutation from
  computed values (numbers < text case-insensitive < blanks-always-last;
  descending reverses non-blanks only) and writes the permuted raw texts as
  one existing-style raw batch — undo/redo comes free. No style movement,
  no ref rewriting on sort (REQ non-goals).
- **Menu is one dumb component** (`ContextMenu.tsx`): fixed-position,
  viewport-clamped, closes on Escape/click-away/scroll/action; item arrays
  are built inside `ExcelGrid` where store + selection + clipboard already
  live. Menu paste uses a new shared `pasteFromSystemClipboard` helper
  (async clipboard API → internal clipboard fallback), extracted from the
  existing Ctrl+V fallback so both paths stay identical.
- No feature flags, no env vars, no compatibility layers: the menu is
  always on (it only appears on right-click), and no existing public
  contract changes.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect `GridStore.ts`, `ExcelGrid.tsx`, `useVirtualRange.ts`,
      `adjust.ts`, `cellRef.ts`, `styles.css` to confirm: no structural ops
      exist, row height is uniform, undo is patch-batch based, tokenizer
      rewrite pattern is reusable. (Done during AP inspection.)
- [x] Confirm no legacy fallback/flag paths are affected; `ExcelGridProps`
      and `ExcelGridHandle` stay untouched. (Confirmed: additions only.)
- [x] Record non-goals (no autofilter UI, no ref-rewrite on sort, no
      range-shrink on delete, view state not undoable, no row resizing) in
      the REQ so implementation does not gold-plate.

### Phase 2 - Foundation: axis remapping + formula rewrite (store)

- [x] Add `remapFormulaAxis(formula, axis, map, rowCount, colCount)` to
      `src/formula/adjust.ts`: token-walk like `adjustFormula`, remap the
      row or col of each ref through `map`, emit `#REF!` for null/out-of-
      bounds, preserve `$` anchors and untouched text.
- [x] Add to `GridStore`: `hiddenRows`/`hiddenCols`/`filteredRows` sets,
      `frozenRows`/`frozenCols` numbers, plus getters
      (`isRowHidden`, `isColHidden`, `hasFilter`, `getFrozenRows`,
      `getFrozenCols`) and view setters (`setRowsHidden`, `setColsHidden`,
      `setFrozenRows`, `setFrozenCols`) that `notify([])`.
- [x] Implement `private snapshotSheet()` / `restoreSheet(snap)` capturing
      raw-cells map, styles map, colWidths map, hiddenRows, hiddenCols,
      filteredRows; extend the `Patch` union with
      `{ kind: "sheet"; before; after }` and handle it in
      `applyPatchBatch` by full restore + rebuild deps + recompute all.
- [x] Implement `private remapAxis(axis, map)`: rebuild the four keyed
      structures through `map`, rewrite every formula raw via
      `remapFormulaAxis`, wipe and re-register deps by re-applying every
      raw, recompute all formulas, push a single `SheetPatch`, notify with
      changes for every occupied+recomputed key.
- [x] Implement public `insertRows(at, n)`, `insertCols(at, n)`,
      `deleteRows(start, end)`, `deleteCols(start, end)`,
      `moveRows(start, end, dir: -1 | 1)`, `moveCols(start, end, dir)` as
      mappings over `remapAxis` (insert drops indices pushed past the last
      row/col; move is the block/adjacent-line permutation; move at the
      sheet edge is a no-op).

### Phase 3 - Foundation: sort + filter (store)

- [x] Implement `getUsedRange(): CellRange | null` over the cells map.
- [x] Implement `sortRange(range, keyCol, dir)`: stable permutation of the
      range's rows by computed value at `keyCol` (numbers first ascending,
      then text case-insensitive, blanks last in both directions), written
      back as one `setCells` batch of the range's raw texts.
- [x] Implement `filterByValue(col, row)`: hide (via `filteredRows`) every
      used-range row whose computed value at `col` differs from the value
      at (`row`,`col`); `clearFilter()` empties `filteredRows`. Both
      `notify([])`.

### Phase 4 - Rendering: hidden sizes, row metrics, frozen panes

- [x] Generalize `useVirtualRange.ts`: rename `buildColMetrics` →
      `buildAxisMetrics` (same math, axis-neutral names), change
      `useVirtualRange` to take row metrics + col metrics; update the
      existing call site.
- [x] In `ExcelGrid.tsx` build `rowHeights` (`0` when `store.isRowHidden`)
      and `rowMetrics`; make `colWidths` yield `0` for hidden cols; replace
      every `row * rowHeight` / `totalHeight` use (cells, row headers,
      `rectForRange`, `coordFromMouse`, `ensureVisible`, editor position,
      spacer) with `rowMetrics` lookups; skip rendering zero-size cells and
      header cells.
- [x] Make arrow/Tab/Enter navigation skip hidden indices via a
      `nextVisible(axis, from, dir)` helper (clamped at sheet edges).
- [x] Add frozen panes: wrap the body in `.xg-bodywrap` (relative); render
      top/left/corner overlay panes (`overflow:hidden`, opaque background,
      boundary border) whose inners counter-translate `-scroll.left` /
      `-scroll.top`; render pane cells plus per-pane selection/active
      rectangles; add non-translated frozen layers to both header strips.
- [x] Fix hit-testing and visibility for frozen panes: `coordFromMouse`
      uses unscrolled coordinates inside the frozen bands; `ensureVisible`
      scrolls targets clear of the frozen bands.

### Phase 5 - Context menu UI and wiring

- [x] Create `src/components/ContextMenu.tsx`: `items: MenuItem[]`
      (`{ label, onClick, disabled? }` or `"sep"`), fixed positioning
      clamped to the viewport via layout-effect measurement, closes on
      Escape / mousedown outside / scroll / after `onClick`.
- [x] Add `.xg-menu`, `.xg-menu-item`, `.xg-menu-item:disabled`,
      `.xg-menu-sep` styles to `src/styles.css` following `.xg-tb-pop`.
- [x] In `ExcelGrid.tsx` extract `pasteFromSystemClipboard()` from the
      Ctrl+V fallback and reuse it for both Ctrl+V and menu Paste; extract
      `copySelection(cut)` from the Ctrl+C/X branch for menu Cut/Copy.
- [x] Add drag + shift-click multi-row/col selection to the header strips
      (`beginHeaderDrag`), replacing the single-line `selectRow`/
      `selectColumn` mousedown wiring — required so "Insert N rows" /
      multi-line hide/delete/move have a way to select N lines.
- [x] Add `onContextMenu` handlers (body panes, row headers, col headers,
      corner excluded): suppress the native menu, re-target selection when
      the click is outside it (full row/col for headers), open the menu
      with zone-specific items.
- [x] Build the three item sets exactly as listed in the REQ, with counts
      in labels ("Insert 3 rows above"), Unhide disabled when the selection
      spans no hidden line, Unfreeze disabled when nothing is frozen,
      Clear filter disabled when `!hasFilter()`, Move disabled at the
      sheet edge.

### Phase 6 - Tests and verification

- [x] Add `remapFormulaAxis` cases to `src/formula/formula.test.ts` (or a
      focused describe block): shift, `#REF!` on delete, `$` anchors,
      ranges, both axes.
- [x] Add `src/state/GridStore.structure.test.ts`: insert/delete/move on
      both axes (content, styles, colWidths shift; overflow drop; formula
      follow + `#REF!`), single-action undo/redo restoring exact sheet,
      hide/unhide + filter interaction, freeze getters/setters,
      `sortRange` ordering (numbers/text/blanks, desc) and undo,
      `getUsedRange`.
- [x] Run `npm run typecheck` and `npm test`; record exact output; fix
      failures.
- [x] Update file comment blocks in every touched source file.

### Phase 7 - E2E, documentation, and status

- [x] Create `.docs/tests/test-context-menus.md` with the browser
      scenarios (menu opening/closing per zone, insert/delete with formula
      check, move, hide/unhide, freeze scroll check, sort, filter,
      clipboard round-trip, undo).
- [x] Execute the E2E spec against the demo (`npm run dev` via the preview
      browser); record observed results per scenario.
- [x] Update `README.md` feature list with the context-menu capabilities.
- [x] Mark plan tasks complete and record final evidence.

## Validation

- `npm run typecheck` → exits 0, no errors.
- `npm test` → all suites pass, including the two new/extended test files;
  report the vitest summary line.
- E2E: run the demo dev server, exercise every scenario in
  `.docs/tests/test-context-menus.md`, and report per-scenario pass/fail
  with screenshots for menu rendering and frozen panes.

### Recorded evidence (2026-07-18)

- `npm run typecheck`: exit 0, no errors.
- `npm test`: `Test Files 6 passed (6)`, `Tests 89 passed (89)` — includes
  `GridStore.structure.test.ts` (17 tests) and the `remapFormulaAxis`
  describe block in `formula.test.ts` (4 tests).
- Browser E2E against the demo (`npm run dev`, port 5199): every scenario
  in `.docs/tests/test-context-menus.md` executed and passed — all three
  menu zones with correct item sets and disabled states, viewport
  clamping, retarget/preserve selection, insert row (formula `=A1+A2` →
  `=A1+A3`), delete row (`#REF!`), single-step undo, insert/delete/move
  columns, move rows (refs follow, value stays 12), hide/unhide rows and
  columns with arrow-key skipping, freeze rows/columns (panes pinned while
  scrolled to 480px / 400px, pinned cells clickable), sort range Z→A and
  sheet sort A→Z by column A (full-row reordering, one-step undo of a
  1328-row sort), filter by Province=BC (visible rows 2, 7, 10, 13… all
  BC) and clear, and menu Cut/Copy/Paste with cut-source clearing via the
  internal-clipboard fallback.

## Rollback / Risk

- Highest-risk area is the frozen-pane render + hit-test math; it is
  isolated to `ExcelGrid.tsx` render helpers and CSS, so reverting freeze
  alone is possible without touching store logic.
- `remapAxis` rebuilds all dependencies and recomputes all formulas —
  correctness over cleverness; per-op cost is O(occupied cells), acceptable
  for this library's scale.
- Renaming `buildColMetrics` is internal-only (not exported from
  `src/index.ts` public surface — verify during Phase 4; if it is exported,
  keep an alias).
- No migrations, no persisted data; full rollback = revert the commit.
