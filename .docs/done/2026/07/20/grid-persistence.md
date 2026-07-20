# Done: grid-persistence

## Summary

- Demo app now autosaves the full grid state (cell raws, styles, column
  widths) to localStorage keyed by file name (`excel-grid-demo:file:{name}`
  + `excel-grid-demo:current`), 300 ms debounced with pagehide/hidden
  flush; boot restores the last file or shows a blank grid (bundled
  accounts-6.json boot data removed).
- New demo header UI: current file name display plus `New` (confirm +
  clear), `Open CSV…` (File API; imported `=` cells apostrophe-escaped),
  and `Save CSV` (displayed text of the used range, Blob download).
- Library gained additive persistence APIs: `GridSnapshot` type,
  `initialState` / `onStateChange` props (fires on style-only and
  width-only edits, unlike `onChange`), `getSnapshot()` on the handle, a
  format-aware `display` field on `getData()` entries, and exported
  `toCSV`/`parseCSV` (tsv.ts generalized by delimiter).

## Verification

- `npm run typecheck` exit 0; `npm test` 171/171 passing (new suites:
  CSV cases in `src/utils/tsv.test.ts`, `src/state/GridStore.snapshot.test.ts`);
  `npm run build` succeeds.
- All six scenarios of `.docs/tests/test-grid-persistence.md` executed in
  the in-app browser against `npm run dev`: autosave on data/style/width
  edits, reload restore (bold + formula + width), blank first load, CSV
  open (quoted commas/quotes/newlines, formula not evaluated), CSV save
  (captured blob verified), New/Clear cancel + confirm paths. Zero
  console errors.
- Independent subagent reviews: AR passed (2 rounds), CR passed (2
  rounds; 1 Medium + 3 Low findings fixed), VR complete (all 7 acceptance
  criteria evidenced).

## Notes

- Some E2E inputs (keyboard, column-resize drag, file picking) were
  driven by JS-dispatched DOM events on the app's real handlers because
  the automation harness's synthetic input did not reach the page.
- CSV export is values-as-displayed by design (LF rows); formulas/styles
  round-trip only via localStorage — REQ non-goal.
- `onStateChange` also fires on view-state changes (search/filter/freeze),
  causing redundant idempotent saves — accepted in the plan.
- `demo/accounts-6.json` stays on disk, now unreferenced.
