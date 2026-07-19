# Plan: Toolbar buttons — vertical alignment, text wrapping, sort, filter, freeze panes

## Goal

The toolbar exposes working vertical-alignment, wrap, sort, filter, and
freeze-pane controls; vertical alignment and wrap become first-class
`CellStyle` properties rendered by the grid, per
`req-toolbar-align-wrap-sort-freeze`.

## Current Context

- `src/types.ts`: `CellStyle` has `align?: HAlign`, `numFmt`, etc. No
  vertical alignment or wrap. Types re-exported via `src/index.ts`.
- `src/state/GridStore.ts`: `applyStyle` generically merges any
  `Partial<CellStyle>` patch (undefined removes a key) with undo and
  `STYLE_CELL_CAP`; `clearFormat` wipes all styling. Sorting
  (`sortRange(range, keyCol, dir)`), filtering (`filterByValue(col, row)`,
  `clearFilter()`, `hasFilter()`), and freezing (`setFrozenRows/Cols(n)`,
  `getFrozenRows/Cols()`) already exist — used today by the context menus in
  `ExcelGrid.tsx` (~lines 790–890).
- `src/components/Toolbar.tsx`: button factory `btn(title, opts, children)`,
  popover pattern (`Popover` union + outside-mousedown close), pressed states
  from `store.getStyle(active)`. Receives `store`, `selRange`, `active`,
  `rows`.
- `src/components/ExcelGrid.tsx`: `cellStyleCss(cs)` (~line 1290) maps
  `CellStyle` to inline CSS; `.xg-cell` in `src/styles.css` is
  `display:flex; align-items:center; white-space:nowrap; overflow:hidden`.
- Verification commands: `npm run typecheck`, `npm test` (vitest),
  `npm run build`.
- Style unit tests live in `src/state/GridStore.style.test.ts`.

## Decisions

- Add `VAlign = "top" | "middle" | "bottom"` and extend `CellStyle` with
  `valign?: VAlign` and `wrap?: boolean`. No GridStore changes needed —
  `applyStyle`/`clearFormat`/undo are key-agnostic.
- Render `valign` via flex `alignItems` (top→flex-start, middle→center,
  bottom→flex-end); absent means default (existing CSS `center`).
- Render `wrap` via `whiteSpace: normal` + `wordBreak: break-word`; row
  height unchanged, overflow stays hidden (REQ non-goal: no auto height).
  Because `.xg-cell` is flex, multi-line text renders inside a single text
  node child; flex line-wrapping quirks don't apply to plain text content,
  so no extra wrapper element is needed.
- Toolbar-only feature wiring: sort/filter/freeze buttons call the existing
  store APIs directly, mirroring the context-menu handlers. Rejected:
  lifting shared action helpers into a new module — the calls are one-liners
  and the duplication is trivial.
- Sort with a single-cell selection uses `store.getUsedRange()` keyed by
  `active.col`; multi-cell uses `selRange` keyed by `selRange.startCol`.
  When the sheet is empty (`getUsedRange()` null) the button is a no-op.
- Filter is one toggle button (`hasFilter()` decides apply vs clear), not
  two buttons — matches the WeCom minimal-toolbar aesthetic.
- Freeze is a popover (new `"freeze"` member of the `Popover` union) with
  three items: freeze rows to `selRange.endRow + 1`, freeze cols to
  `selRange.endCol + 1`, unfreeze both (disabled when nothing frozen).
- No new component props, no feature flags, no compatibility layers.
- E2E coverage: yes — user-facing toolbar flows. Spec at
  `.docs/tests/test-toolbar-align-wrap-sort-freeze.md`, executed against the
  demo app (`npm run dev`) with browser tools.

## Phased Tasks

### Phase 1 - Types and style rendering

- [x] Add `VAlign` type and `valign?: VAlign` / `wrap?: boolean` to
      `CellStyle` in `src/types.ts`; add the `VAlign` re-export to
      `src/index.ts` alongside `HAlign`.
- [x] Extend `cellStyleCss` in `src/components/ExcelGrid.tsx` to emit
      `alignItems` from `valign` and `whiteSpace`/`wordBreak` from `wrap`.
- [x] Keep wrapped text aligned when justified: add `text-align: right` to
      `.xg-cell--num` in `src/styles.css` and emit `textAlign` alongside
      `justifyContent` for `align` in `cellStyleCss` (flex `justifyContent`
      has no effect on the inner line boxes of wrapped text).
- [x] Update the file comment blocks in `types.ts` and `ExcelGrid.tsx`.

### Phase 2 - Toolbar controls

- [x] In `src/components/Toolbar.tsx`, add a `setVAlign(v)` handler (toggle
      semantics like `setAlign`) and three buttons (顶端对齐 / 垂直居中 /
      底端对齐) with new `IconVAlign` SVG icons, pressed from
      `activeStyle.valign`.
- [x] Add a wrap toggle button (自动换行) with an `IconWrap` SVG icon,
      pressed from `activeStyle.wrap`, applying `{ wrap: true | undefined }`.
- [x] Add sort ascending/descending buttons (升序 / 降序) with icons:
      multi-cell selection → `store.sortRange(selRange, selRange.startCol,
      dir)`; single cell → `store.sortRange(used, active.col, dir)` with
      `used = store.getUsedRange()`, no-op when null. Disable both buttons
      for a multi-cell selection that spans a single row (`sortRange`
      early-returns there; the context menu disables sort in that case —
      stay consistent).
- [x] Add the filter toggle button (筛选) with an icon: `store.hasFilter()`
      ? `store.clearFilter()` : `store.filterByValue(active.col,
      active.row)`; pressed while `hasFilter()`.
- [x] Add the freeze popover: extend the `Popover` union with `"freeze"`,
      button (冻结) pressed while `getFrozenRows() > 0 || getFrozenCols() >
      0`, popover items "冻结至第 N 行" (`setFrozenRows(selRange.endRow +
      1)`, N = `selRange.endRow + 1`) and "冻结至第 X 列"
      (`setFrozenCols(selRange.endCol + 1)`, X =
      `colToLetters(selRange.endCol)` — the context menu uses column
      letters), and
      "取消冻结" (both to 0, disabled when nothing frozen); close popover on
      action.
- [x] Add any needed popover/menu CSS for the freeze list to
      `src/styles.css`, reusing `.xg-tb-pop` patterns.
- [x] Update the Toolbar.tsx file comment block.

### Phase 3 - Tests and verification

- [x] Add unit tests in `src/state/GridStore.style.test.ts`: applying
      `valign`/`wrap` merges with existing style keys, re-applying
      `undefined` removes them, undo/redo restores, and `clearFormat`
      removes them.
- [x] Run `npm run typecheck`, `npm test`, and `npm run build`; record
      results.

### Phase 4 - E2E and documentation

- [x] Execute `.docs/tests/test-toolbar-align-wrap-sort-freeze.md` scenarios
      against the demo app and record observed results.
- [x] Verify REQ acceptance criteria and update the REQ checkboxes with
      evidence (VR stage).

## Validation

- `npm run typecheck` — no TypeScript errors.
- `npm test` — all vitest suites pass, including new style-key tests.
- `npm run build` — library build succeeds.
- E2E per `.docs/tests/test-toolbar-align-wrap-sort-freeze.md`: visible
  vertical alignment change, multi-line wrapped text, sorted values,
  filtered rows hidden and restored, frozen panes sticking during scroll —
  verified in the demo app with browser tools, with screenshots/DOM reads
  as evidence.

## Rollback / Risk

- All changes are additive (new optional style keys, new toolbar buttons);
  rollback is reverting the commit.
- Risk: wrapped text inside a flex cell could interact oddly with
  `justifyContent` for numbers — verify a wrapped numeric cell still
  right-aligns.
- Risk: toolbar width grows; buttons may overflow on narrow viewports.
  Existing toolbar has no overflow handling; acceptable, matches current
  behavior (no new handling in scope).
- Freeze/sort/filter are view-state or raw-batch operations with existing
  undo semantics (sort undoable, filter/freeze not); toolbar introduces no
  new undo paths.
