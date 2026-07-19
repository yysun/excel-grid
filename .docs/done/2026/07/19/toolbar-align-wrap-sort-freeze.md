# Done: Toolbar — vertical alignment, wrap, sort, filter, freeze panes

## Summary

- Added `VAlign` type plus `CellStyle.valign`/`wrap`; both flow through the
  existing style layer (undoable, cleared by clear-format, `STYLE_CELL_CAP`).
- Cell rendering honors them: `alignItems` for valign, `whiteSpace`/
  `wordBreak` for wrap, and `textAlign` so wrapped text (incl. numbers via
  `.xg-cell--num { text-align: right }`) keeps its horizontal alignment.
- Toolbar gains: 顶端对齐/垂直居中/底端对齐 toggles, 自动换行 toggle,
  升序/降序 sort (selection by first column; single cell sorts the used
  range by the active column; disabled for single-row selections), 筛选
  toggle (filter by active cell value / clear), and a 冻结 popover
  (freeze rows/cols to selection, unfreeze) — all reusing existing
  GridStore APIs with pressed states and Chinese tooltips.

## Verification

- `npm run typecheck` clean; `npm test` 92/92 pass (style suite grew to 16
  with new valign/wrap merge/undo/clear-format tests); `npm run build` OK.
- Independent AR, CR, and VR subagent reviews all passed (no blocking/high
  findings; VR matrix: all 9 acceptance criteria complete).
- Browser E2E per `.docs/tests/test-toolbar-align-wrap-sort-freeze.md`
  against the demo app: alignment shifts, 2-line wrap in 24px rows,
  asc/desc sort + undo, BC-only filter + restore, frozen rows/cols pinned
  during scroll + unfreeze, popover outside-click close, wrapped-number
  right-alignment — all observed via DOM reads and screenshots.

## Notes

- Sort scenario used demo-data city names rather than the spec's literal
  `3/1/2/banana` values; numbers-before-text ordering is covered by unit
  tests instead.
- Left uncommitted (session tooling, not story scope): `demo/vite.config.ts`
  now honors a `PORT` env var and `.claude/launch.json` gained
  `autoPort: true` so a second dev server can run alongside another session.
- Known parity quirks inherited from the context menus (not regressions):
  freeze label can overstate by one at the sheet edge; sorting while a
  filter is active reorders values through filter-hidden rows.
