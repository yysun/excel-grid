# Done: column-filter-popup

## Summary

- Toolbar Filter button now toggles Excel-style filter mode: on enables
  filter buttons on the selected columns, off removes all buttons and
  clears all filters.
- Filter-mode columns show an always-visible funnel button in the lettered
  header (filled + highlighted while that column's filter excludes values),
  opening a new FilterPopup: distinct sorted values with counts and
  checkboxes, "(Blanks)" entry, case-insensitive search, tri-state Select
  all, OK/Cancel (OK disabled when nothing is checked).
- GridStore filter model rebuilt: per-column allowed value-key sets with
  AND semantics replace the single `filterByValue` filter; `filteredRows`
  is now a derived cache recomputed on every notify, so edits, undo/redo,
  and structural changes keep visibility correct; filter state rides in
  SheetSnapshot so structural undo keeps filters on the right columns.
- Context menu rewired: "Filter by cell value" sets a single-value column
  filter; "Clear filter" clears filters but keeps the buttons.

## Verification

- `npm run typecheck` → 0 errors; `npm run test` → 110/110 (18 new tests in
  `GridStore.filter.test.ts`; legacy filter test rewritten); `npm run
  build` → success.
- Browser E2E per `.docs/tests/test-column-filter-popup.md` on the demo
  app: toggle on/off, popup contents/ordering, multi-value filtering, AND
  across columns, edit re-evaluation, reopen-state, Cancel, search,
  context-menu paths, highlight/pressed states all verified.
- Independent AR (2 blocking doc flaws fixed pre-implementation), CR (no
  high-severity findings; 3 low-severity polish items applied), and VR
  (12/12 acceptance criteria PASS) review passes.

## Notes

- Values keyed by canonical string of the computed value: number `1` and
  text `"1"` merge into one filter entry (documented trade-off).
- Filter changes themselves are not undoable (view state, per REQ);
  structural undo restores filter state as a side effect of SheetSnapshot.
- A filter set after a structural edit is discarded when that edit is
  undone — same behavior as hidden columns today.
