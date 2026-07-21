# Row height resize + wrap-text auto-fit

## Summary
- Fixed two bugs reported by the user: row height could not be manually adjusted, and enabling "Wrap text" on a cell did not expand its row to fit the wrapped content.
- `GridStore` now tracks per-row heights (`getRowHeight`/`setRowHeight`/`hasRowHeightOverride`), mirroring the existing `colWidths` pattern, including undo-safe structural remapping (insert/delete/move rows), sheet-snapshot equality checks, and `getSnapshot()`/`getWrapCells()` for host-side persistence and layout.
- `ExcelGrid` adds a drag grip (`.xg-resize-grip--row`) on the bottom edge of each row header, wired to `setRowHeight`, matching the existing column-resize UX.
- Rows containing wrapped cells auto-expand to fit their content: a canvas-based line-count estimate (`countWrappedLines`) measures wrapped text against the cell's actual column width and font, and the computed height wins unless the row was manually resized (manual resize always takes precedence, matching Excel's own AutoFit-vs-manual behavior).
- `GridSnapshot` gained a `rowHeights` field; `.xlsx` import/export (`src/utils/xlsx.ts`) now round-trips row heights via the `ht`/`customHeight` row attributes (points ↔ px conversion), keeping column-width handling as the parity reference.

## Verification
- `npx tsc --noEmit -p .` — no errors.
- `npx vitest run` — 190/190 tests passed (updated `GridStore.snapshot.test.ts` and `xlsx.test.ts` for the new `rowHeights` snapshot field).
- Manual browser verification via the demo app (`npm run dev`):
  - Typed wrapped text into a cell, enabled Wrap text from the toolbar, confirmed the row auto-expanded from 24px to 164px to fit all lines.
  - Dragged a row header's resize grip and confirmed the row height changed accordingly (24px → 64px).

## Notes
- No REQ/AP docs were created for this story; it was implemented directly from the bug report before the RPD workflow was invoked. This DD doc stands in as the completion record.
- Row-height auto-fit is intentionally overridden by any manual row resize (Excel-consistent behavior); there's no "reset to auto-fit" affordance yet — out of scope for this fix.
- xlsx row-height export only emits `ht`/`customHeight` for rows that already contain at least one cell (mirrors how the writer iterates `byCoord`); a row with only a custom height and no cell content won't round-trip. Acceptable given existing column-width writer has the same shape of limitation and this wasn't part of the reported bug.
