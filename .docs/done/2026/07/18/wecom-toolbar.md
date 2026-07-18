# Done: wecom-toolbar — WeCom-style minimal toolbar for ExcelGrid

## Summary

- Added a 企业微信表格-style flat toolbar above the formula bar (new
  `toolbar` prop, default `true`): undo/redo, 清除格式, `%` / `,` / decimal
  ±, font-size dropdown, B/I/U/S, text & fill color palettes with Automatic
  reset, alignment L/C/R, and Σ quick sum — Chinese tooltips, inline SVG
  icons, no new dependencies.
- Introduced a sparse per-cell style layer in `GridStore`
  (`CellStyle`: bold/italic/underline/strike, fontSize, color, background,
  align, numFmt, decimals) with `applyStyle`/`clearFormat`/`getStyle`,
  capped at 200k cells per action.
- Undo/redo now runs on a raw|style patch union — one Ctrl+Z timeline for
  edits and formatting.
- Cells render their style inline (virtualization-safe, sparse) and
  `getDisplay` applies percent/thousands/fixed-decimal formats to numeric,
  non-error values only; raw values and formulas untouched.
- Exported `CellStyle`/`NumFmt`/`HAlign` types; README updated.

## Verification

- `npm run test`: 68/68 pass (13 new style-layer tests incl. interleaved
  undo/redo, format display, cap no-op).
- `npm run typecheck` and `npm run build`: clean.
- Browser E2E per `.docs/tests/test-wecom-toolbar.md` (T1–T9) against the
  demo on :5199: all scenarios pass, verified via screenshots + computed
  styles + onChange log.
- CR found and fixed one high-priority bug: `overflow-x: auto` on the
  toolbar clipped the color/size popovers invisibly; bar now wraps instead
  of scrolling (re-verified visually).

## Notes

- Popovers close on outside click or after a pick, not on Escape (简约
  scope).
- Styles are display-only: not exposed via `getData()` (REQ non-goal).
- Delete/Backspace clears values but not formats, matching Excel.
- Non-goals unchanged: merge, borders, format painter, font family, filter,
  sort, freeze, search, 常规 dropdown.
