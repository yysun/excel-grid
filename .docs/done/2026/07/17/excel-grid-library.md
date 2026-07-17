# Done: excel-grid-library

## Summary

- New React component library `excel-grid` exporting `ExcelGrid`: an Excel-Web/Google-Sheets-style grid with lettered/numbered headers, formula bar, and virtualized rendering (≈400 DOM cells for a 10,000 × 100 sheet).
- Full interaction model: click/drag/Shift/header/Ctrl+A selection; Excel keyboard navigation; in-cell + formula-bar editing (double-click, F2, type-to-replace); Delete clears; undo/redo as batched inverse patches.
- Hand-rolled formula engine (tokenizer → recursive-descent parser → evaluator + dependency graph): 13 functions, Excel operator precedence, incremental recalculation, `#CYCLE!`/`#NAME?`/`#VALUE!`/`#DIV/0!`/`#REF!` error values.
- TSV clipboard interop via native copy/cut/paste events with async-Clipboard-API and internal fallbacks; copied/filled formulas adjust relative references ($ anchors respected).
- Column resize by header-edge drag; fill handle tiles values/formulas down/right with per-cell reference adjustment.
- Library build: ESM + CJS + `.d.ts` + namespaced `styles.css` via Vite lib mode; React externalized as peer dep. Demo app (`npm run dev`, port 5199) plus README with full API docs.

## Verification

- `npm run typecheck` — clean (tsc strict).
- `npm test` — 55/55 Vitest unit tests passing (cell refs, TSV, parser/evaluator/every function, error cases, reference adjustment, store recalc/undo).
- `npm run build` — `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `dist/styles.css`; grep confirmed react/react-dom imported, not bundled.
- E2E `.docs/tests/test-excel-grid-library.md` S1–S10 executed against the live demo in the browser pane — all scenarios pass (virtualization cell count, selection geometry, nav, editing, formula recalc chain B2→D2→D6→D7→D8, error cells, copy/paste with `=A16+B16`→`=A18+B18` adjustment, cut-move, batch undo/redo, resize 111→150px, fill-handle formula tiling, imperative API buttons).
- Two bugs found and fixed during E2E: header clicks stole keyboard focus (fixed via preventDefault) and clipboard shortcuts lacked a non-event fallback (added async Clipboard API + internal clipboard path).

## Notes

- Cut-paste adjusts relative references like copy-paste (real Excel preserves them on move) — acceptable per REQ, noted as a future refinement.
- Numeric display is unformatted `String(value)` (e.g. long averages show full precision); number formatting is an explicit non-goal.
- System-clipboard round-trip was verified via the fallback path; CDP-synthesized shortcuts can't trigger native copy/paste events, though real user keystrokes do.
- Non-goals unchanged: formatting UI, merged cells, frozen panes, row resize, sorting/filtering, multi-sheet, xlsx IO.
