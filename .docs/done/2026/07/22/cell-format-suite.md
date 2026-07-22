# Done: Merged cells, borders, format painter, and font family

Story: `cell-format-suite` — completed 2026-07-22. REQ:
`.docs/reqs/2026/07/22/req-cell-format-suite.md`. Plan:
`.docs/plans/2026/07/22/plan-cell-format-suite.md`.

## Summary

- Closed all four items on README's "Not (yet) included" list in one pass:
  merged cells (merge/unmerge, merge-aware selection/navigation/editing,
  structural-edit remapping), per-side cell borders (all/outer/single-edge/
  none presets with color + thickness), a format-painter toolbar toggle,
  and a font-family dropdown.
- `CellStyle` gained `border`/`fontFamily`; `GridSnapshot` gained `merges`
  — both additive, so old snapshots keep loading unchanged.
- Selection splits into two values in `ExcelGrid.tsx`: `rawSelRange` (the
  literal drag/selection, driving clipboard and every row/column-count
  structural menu action) and merge-expanded `selRange` (driving rendering,
  Delete/Backspace, and Toolbar style actions) — this split exists because
  a single merge-expanded range was found, during architecture review, to
  silently widen destructive row/column operations whenever the selection
  merely touched a merge.
- xlsx round-trip extended: a `borders` interning table (parallel to the
  existing `fonts`/`fills`), real `<name>` font-family round-trip (was
  hardcoded to "Calibri"), and `<mergeCells>` read/write.

## Verification

- `npm run typecheck`, `npm test` (234 tests across 14 files, including new
  `GridStore.merge.test.ts` and extended `GridStore.style.test.ts`/
  `xlsx.test.ts`), and `npm run build` all pass cleanly.
- Two rounds of independent architecture review (before implementation)
  found and fixed two real design gaps: the selection-expansion issue
  above, and a merge-remapping algorithm for row/column moves that could
  silently corrupt a merge straddling a move's swap boundary (fixed via a
  `monotonic` flag on `remapAxis` with an order-preserving, gap-checked
  remap for the non-monotonic move case).
- Independent code review (after implementation) found and fixed three
  more real bugs, each now covered by a regression test: `applyBorder`'s
  single-edge presets touching every cell instead of just the boundary;
  `stylesEqual`'s shallow comparison making `applyBorder` non-idempotent
  (spurious undo steps on re-applying an identical preset); and
  `remapMergeAxis`'s monotonic branch requiring both merge corners to
  survive a delete, wrongly dropping (instead of shrinking) a merge whose
  delete only touched its far edge.
- Live browser E2E against the demo app (`.docs/tests/test-cell-format-suite.md`)
  confirmed: merge/unmerge with correct value/style handling, click-to-
  select-whole-block with anchor resolution, arrow-key step-over, double-
  click-edit-anchor, the row-header structural-safety fix (right-clicking
  a row inside a taller merge showed "Insert row above" — singular, not
  widened), border presets with exact computed CSS, font-family selection
  and rendering, and format-painter arm/apply/auto-disarm.
- This E2E pass also caught a real crash: `Toolbar`'s search-column-sync
  effect depended on `selRange`'s object identity, which now changes every
  render that touches merges, creating an infinite render loop with its own
  `store.notify()`. Fixed by keying the effect on the range's primitive
  bounds instead of its object reference.

## Notes

- Non-goals (documented in the REQ, not oversights): solid thin/medium/
  thick borders only (no dashed/dotted/double/diagonal); merges are not
  guaranteed to render correctly across a frozen-pane boundary; fill-handle
  drag behavior across merged cells is undefined; format painter is
  single-use (no Excel-style lock) and always broadcasts the source
  selection's top-left cell style rather than tiling a pattern.
- Not independently re-verified via browser automation (lower risk, already
  covered by dedicated unit tests): the xlsx save/reload file-picker round
  trip, "Outside borders" exact edge rendering, and drag-range format-
  painter destinations.
- `README.md` updated (Interactions, Ref API, "Not (yet) included").
