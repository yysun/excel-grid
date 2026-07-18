# Done: Context menus for rows, columns, and cells

Story: `context-menus` — completed 2026-07-18.

## Summary

- Right-click now opens context-appropriate menus (cell / row header /
  column header) with working Cut/Copy/Paste, insert/delete/move,
  hide/unhide, freeze/unfreeze, sort, and filter actions.
- One structural primitive (`GridStore.remapAxis`) powers insert, delete,
  and move on both axes: content, styles, column widths, and hidden flags
  are remapped, formulas are rewritten sheet-wide via a new
  `remapFormulaAxis` (refs to deleted lines become `#REF!`), and each edit
  undoes as a single sheet-snapshot step.
- Hidden rows/columns render zero-size through new axis metrics (rows moved
  off uniform-height math); arrow navigation skips them; filter-by-value is
  a separate hidden set so Clear filter and Unhide stay independent.
- Frozen panes are transform-synced overlay panes (top/left/corner) with
  pinned header strips; frozen cells remain clickable via frozen-aware
  hit-testing.
- Header strips gained drag/shift-click multi-row/column selection so the
  N-line menu actions have a selection model.
- New `ContextMenu` component (viewport-clamped, closes on
  Escape/keydown/click-away/scroll/action, restores grid focus on close).

## Verification

- `npm run typecheck` — exit 0.
- `npm test` — 6 files, 89 tests passed (17 new structure tests, 4 new
  remap tests).
- Browser E2E: all scenarios in `.docs/tests/test-context-menus.md`
  executed against the demo and passed (evidence recorded in the plan doc).
- CR ran twice; fixes applied: manual-vs-filter unhide detection, no-op
  structural edits skip the undo stack, right-click commits an open editor,
  any keydown closes the menu, menu close refocuses the grid.

## Notes

- Non-goals held: no autofilter UI, no ref rewriting on sort, view state
  (hide/freeze/filter) not undoable, deleted range endpoints become `#REF!`
  rather than shrinking.
- Known cosmetic limits: fill handle renders only in the scrolling layer;
  the top frozen pane overlays the scrollbar corner.
- Structural undo restores the hidden/filter sets captured with the edit,
  so a hide performed after a structural edit is superseded by that edit's
  undo — accepted snapshot semantics.
