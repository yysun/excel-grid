# Done: format-dropdown

## Summary

- Added a Google Sheets-style "123" format dropdown to the toolbar
  (tooltip "More formats") listing Automatic, Number, Percent,
  Scientific, and Currency with right-aligned example output and a check
  mark on the active cell's format.
- Widened `NumFmt` with `"number" | "currency" | "scientific"` (additive,
  no stored-style shape change) and extended `formatNumber`: grouped
  2-decimal Number, `$`-prefixed Currency with the sign before the `$`,
  and uppercase-exponent Scientific; `decimals` still overrides each
  default.
- "Automatic" clears `numFmt` and `decimals` in one undoable patch; the
  dropdown and the existing % toggle stay in sync via shared style state.
- Fixed `bumpDecimals` to start from the active format's default digit
  count so "increase decimals" on a 2-decimal format goes 2 → 3 instead
  of 2 → 1.

## Verification

- `npm run typecheck`, `npm run test` (7 files, 115 tests incl. 5 new
  formatNumber cases), and `npm run build` all pass.
- Browser E2E per `.docs/tests/test-format-dropdown.md` on the demo app:
  menu contents/examples, all format renderings on `1234.5`, Automatic
  reset, check-mark and % toggle sync both directions, decimal bumps,
  negative currency `-$…`, text cell unaffected, undo, and outside-click
  close with grid focus retained — all observed passing.
- Independent AR, CR, and VR subagent reviews: no blocking or major
  findings; minor doc corrections applied (menu CSS width note, E2E
  decimal-step continuity, REQ Escape-close wording).

## Notes

- `FMT_DEFAULT_DECIMALS` (Toolbar) and the `d ?? 2` defaults in
  `formatNumber` encode the same "2 decimals" knowledge in two places —
  acceptable now, worth a shared constant if formats grow.
- Thousands format intentionally has no dropdown row (its toggle
  remains), so a thousands-formatted cell shows no check mark in the menu.
- Non-goals unchanged: no date/time/custom formats, no locale or currency
  selection.
