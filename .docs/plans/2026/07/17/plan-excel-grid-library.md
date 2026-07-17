# Plan: excel-grid-library

## Goal

A buildable React component library in this repo whose `ExcelGrid` export delivers the Excel-Web-style behaviors in `req-excel-grid-library.md`: virtualized grid chrome, selection, keyboard nav, editing, formulas with recalculation, clipboard, undo/redo, column resize, fill handle, typed public API, plus a demo app and passing unit tests.

## Current Context

- `/Users/esun/Documents/Projects/excel-grid` is empty (no git repo, no package.json). Everything is greenfield; no legacy constraints.
- Node/npm available on the machine (darwin). Toolchain must be chosen from scratch.
- Verification commands will be defined by this plan itself: `npm run build`, `npm test`, demo via Vite dev server.
- Known unknowns: exact Node version on machine (check during Phase 1); clipboard permission behavior in the preview browser (E2E fallback: exercise internal copy/paste path).

## Decisions

- **Tooling**: Vite + `vite build --lib` for ESM/CJS bundles, `vite-plugin-dts` for typings, Vitest (+ jsdom) for unit tests, a `demo/` Vite app in the same package using a path alias to `src/`. One package at repo root — a monorepo adds overhead with no second package to justify it. **Rejected**: tsup (fine, but Vite already serves the demo, one tool fewer), webpack/rollup direct (more config).
- **Rendering**: DOM-based windowing implemented in-library — a scroll container with a sized spacer and absolutely positioned visible cells. **Rejected**: react-window/react-virtuoso (runtime dep, REQ forbids), canvas rendering (REQ forbids), CSS `content-visibility` (insufficient control at 1M cells).
- **State model**: sparse `Map<"r,c", Cell>` storage inside a single `useReducer`-style store (`GridStore` class held in a ref, with subscription-based re-render via `useSyncExternalStore`). Sparse map because 10,000×100 is mostly empty. Undo/redo = stack of inverse cell-patch batches recorded per committed action.
- **Formula engine**: hand-rolled tokenizer → Pratt/recursive-descent parser → AST evaluator, plus a dependency graph (cell → dependents) for incremental recalculation with cycle detection via DFS in-progress marking. Formulas stored as raw text; computed values cached in the cell record. **Rejected**: eval-based tricks (unsafe), full topological rebuild on every edit (fine at this scale but the graph is simple enough to do incrementally).
- **Reference adjustment** (paste/fill): re-tokenize the formula and shift relative references by the offset; out-of-bounds refs become `#REF!`. `$` anchors parse but are treated as absolute during adjustment.
- **Clipboard**: intercept native `copy`/`cut`/`paste` events on the grid container (works without permission prompts) and also keep an internal clipboard so in-app copy/paste works if the event path is unavailable. TSV as the interchange format.
- **Styling**: one `styles.css` with an `xg-` class prefix, exported from the package (`import "<pkg>/styles.css"` and also injected by the demo).
- **No feature flags, no env vars, no compatibility layers** — single code path everywhere; REQ requires none.
- **Non-goals honored**: no formatting UI, sorting, filtering, frozen panes, merged cells, row resize, xlsx IO.

## Phased Tasks

### Phase 1 - Scaffold and toolchain

- [x] Check `node --version` / `npm --version`, then create `package.json` (name `excel-grid`, private-registry-agnostic), with React 18 peer deps, scripts `dev`, `build`, `test`, `typecheck`.
- [x] Install dev deps: `react`, `react-dom`, `typescript`, `vite`, `@vitejs/plugin-react`, `vite-plugin-dts`, `vitest`, `jsdom`, `@types/react`, `@types/react-dom`.
- [x] Create `tsconfig.json` (strict), `vite.config.ts` (lib mode: ESM+CJS, externalize react/react-dom/jsx-runtime, dts plugin, vitest config), and demo entry `demo/index.html` + `demo/main.tsx`.
- [x] Confirm the empty-scaffold `npm run build` and `npm test` (no tests yet → allow pass-with-no-tests) run cleanly.

### Phase 2 - Core model and utilities

- [x] Implement `src/types.ts`: `CellValue`, `Cell` (raw text, computed value, error), `CellCoord`, `CellRange`, `GridChange`, public props types.
- [x] Implement `src/utils/cellRef.ts`: column index ↔ letters (A…Z, AA…), `parseCellRef`/`formatCellRef` (with `$` anchor parsing), `parseRange`, range normalization/iteration.
- [x] Implement `src/utils/tsv.ts`: selection → TSV serialization and TSV → 2-D string array parsing (quotes/newlines handled the way Sheets emits them).
- [x] Implement `src/state/GridStore.ts`: sparse cell map, `getCell/setCells/clearRange`, change events, undo/redo stacks recording inverse patches per committed batch, `onChange` notification with changed coords.

### Phase 3 - Formula engine

- [x] Implement `src/formula/tokenizer.ts` and `src/formula/parser.ts`: tokens for numbers, strings, booleans, refs, ranges, operators `+ - * / ^ % & = <> < <= > >=`, parens, commas, function names; recursive-descent parser with Excel precedence producing an AST.
- [x] Implement `src/formula/evaluate.ts`: AST evaluation against a cell-value resolver; coercion rules; error values `#NAME?`, `#VALUE!`, `#DIV/0!`, `#REF!`, `#CYCLE!` propagating through operators.
- [x] Implement `src/formula/functions.ts`: `SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ROUND, ABS, CONCATENATE, AND, OR, NOT` over scalar and range args.
- [x] Implement `src/formula/depGraph.ts`: extract references from an AST, maintain dependents map, incremental recalculation order via DFS with cycle detection → `#CYCLE!` on all cells in the cycle.
- [x] Implement `src/formula/adjust.ts`: shift relative references in a formula string by (dRow, dCol); `$`-anchored parts stay fixed; out-of-range → `#REF!`.
- [x] Wire the engine into `GridStore`: setting raw text starting with `=` parses, stores AST/deps, computes value, and recomputes dependents.

### Phase 4 - Grid UI

- [x] Implement `src/components/useVirtualRange.ts`: given scroll offset, viewport size, row height, and column widths (resizable → prefix-sum lookup), return visible row/col index windows with overscan.
- [x] Implement `src/components/ExcelGrid.tsx`: scroll container, spacer, absolutely positioned cell layer, sticky column/row headers, select-all corner, formula bar; subscribes to `GridStore` via `useSyncExternalStore`.
- [x] Implement selection state + mouse interactions: click, drag-range, Shift+click, header row/col selection, Ctrl/Cmd+A; render active-cell outline and range highlight distinctly.
- [x] Implement keyboard navigation on a focusable grid container: arrows, Shift+arrows (extend), Tab/Shift+Tab, Enter/Shift+Enter, Home, Ctrl/Cmd+Home, PageUp/PageDown; scroll active cell into view.
- [x] Implement the cell editor overlay: open via double-click / F2 / type-to-replace; commit on Enter (move down), Tab (move right), blur; cancel on Escape; Delete/Backspace clears selection. Formula bar as an alternate editor for the active cell.
- [x] Implement clipboard: `copy`/`cut`/`paste` event handlers on the container producing/consuming TSV, internal-clipboard fallback, formula reference adjustment on paste, cut clearing source on paste.
- [x] Implement column resize: 4px hit area at header right edge with `col-resize` cursor, drag updates width in store (min width), widths feed `useVirtualRange`.
- [x] Implement fill handle: square at selection bottom-right, drag preview, on release fill target range by tiling source with `adjust.ts`, recorded as one undoable batch.
- [x] Implement `src/styles.css` (all selectors under `.xg-`) and `src/index.ts` exporting `ExcelGrid`, types, and the imperative ref API (`getCell`, `setCell`, `getData`).

### Phase 5 - Demo app

- [x] Build `demo/main.tsx`: mounts `ExcelGrid` with 10,000×100, sample data block (numbers, strings, and formulas incl. `SUM`/`AVERAGE`/`IF`), an `onChange` log, and buttons exercising the imperative API.
- [x] Add `.claude/launch.json` entry for the demo dev server and verify it loads in the browser pane.

### Phase 6 - Tests and verification

- [x] Add Vitest unit tests: `cellRef` (letters round-trip incl. Z→AA, `$` parsing), `tsv` (round-trip, quotes/newlines), tokenizer/parser (precedence, `%`, `&`, comparisons, strings), evaluator + every listed function, error cases (`#NAME?`, `#VALUE!`, `#DIV/0!`, `#CYCLE!`, `#REF!`), dependency recalculation, `adjust` (relative shift, `$` anchors, out-of-bounds `#REF!`), GridStore undo/redo semantics.
- [x] Run `npm test` and `npm run typecheck`; record output; fix failures at root cause.
- [x] Run `npm run build`; confirm `dist/` has ESM + CJS + `.d.ts` and that react is not bundled (grep the bundle).
- [x] Verify no leftover scaffold artifacts, unused deps, or dead files remain.

### Phase 7 - E2E and docs

- [x] Execute `.docs/tests/test-excel-grid-library.md` scenarios against the running demo in the browser pane; record evidence per scenario.
- [x] Write `README.md`: install, peer deps, usage snippet, props/ref API table, supported formula functions, styling note.
- [x] Update this plan's checkboxes to reflect actual completion.

## Validation

- `npm run typecheck` → tsc exits 0.
- `npm test` → all Vitest suites pass; report counts.
- `npm run build` → `dist/index.js` (ESM), `dist/index.cjs`, `dist/index.d.ts`, and one CSS asset exist in `dist/` (exact CSS filename set by Vite lib mode and mapped in package.json `exports`); grep of `dist/index.js` confirms react/react-dom are imported, not bundled.
- Demo dev server renders; browser-pane E2E per `.docs/tests/test-excel-grid-library.md` (selection, nav, edit, formula recalculation, error values, copy/paste with ref adjustment, undo/redo, column resize, fill handle, virtualization DOM-node count).

## Rollback / Risk

- Greenfield repo: rollback = delete generated files; no data or migration risk.
- **Risk — clipboard in E2E browser**: async Clipboard API may be permission-gated; native event path + internal clipboard is the mitigation, and E2E validates via synthesized copy/paste events if needed.
- **Risk — virtualization perf**: prefix-sum width lookup is O(log n) per column via binary search; 100 columns is small, so acceptable.
- **Risk — formula-engine scope creep**: engine limited to listed functions/operators; anything else must return `#NAME?` rather than growing scope.
- **Risk — jsdom limitations**: unit tests target pure logic modules (parser, store, utils); UI behavior is covered by E2E in a real browser instead of brittle jsdom event simulation.
