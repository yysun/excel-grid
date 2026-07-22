# Done: Format-painter icon/position and split merge/unmerge buttons

Story: `cell-format-suite` — follow-up completed 2026-07-22, on top of
`.docs/done/2026/07/22/cell-format-suite.md`.

## Summary

- Redrew the Format Painter toolbar icon (`Toolbar.tsx`'s `IconPainter`) as
  a clearer tilted brush with a paint stroke beneath it, replacing the
  original abstract paintbrush glyph.
- Moved the Format Painter button from the merge/painter cluster to sit
  directly to the right of "Clear formatting".
- Replaced the single toggling "Merge cells"/"Unmerge cells" button with
  two independent, always-visible buttons — "Merge cells" (disabled unless
  2+ cells are selected) and a new "Unmerge cells" button with its own
  icon (`IconUnmerge`, two separate boxes) (disabled unless the active
  cell is inside a merge) — so unmerge no longer requires first landing on
  a merged cell to reveal it via a changing label.

## Verification

- `npm run typecheck` and `npm test` (234 tests, 14 files) both pass
  unchanged.
- Live browser check against the demo: confirmed button order (Undo,
  Redo, Clear formatting, Format Painter, …, Merge cells, Unmerge cells),
  both new/redrawn icons rendering correctly (inspected the painter icon
  at 6x scale), and independent enable/disable behavior for the two merge
  buttons.

## Notes

- Only `src/components/Toolbar.tsx` changed; no store or rendering logic
  was touched, so this was a UI-only tweak on top of the already-verified
  `cell-format-suite` story.
- The cell-menu's right-click "Merge cells"/"Unmerge cells" item (in
  `ExcelGrid.tsx`) was left as a single contextual item — a right-click
  menu already only shows one relevant action at a time, so the "split
  into two visible buttons" rationale (a fixed always-visible toolbar
  button whose label changes is easy to miss) doesn't apply there.
