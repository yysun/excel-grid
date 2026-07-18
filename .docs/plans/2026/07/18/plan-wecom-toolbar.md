# Plan: wecom-toolbar — WeCom-style minimal toolbar for ExcelGrid

## Goal

A WeCom-styled toolbar renders above the formula bar (default on, `toolbar`
prop to hide) whose controls actually mutate a new per-cell style layer in
`GridStore`, with full undo/redo integration and styled/number-formatted cell
rendering, per `req-wecom-toolbar.md`.

## Current Context

- `src/state/GridStore.ts`: sparse `cells` map, undo/redo as `Patch[][]`
  batches where `Patch = {row, col, before, after}` over **raw text only**.
  `notify()` bumps a version consumed via `useSyncExternalStore`.
  `getDisplay()` stringifies values; no style storage anywhere.
- `src/components/ExcelGrid.tsx`: renders formula bar + virtualized cells;
  cell divs get positional inline styles only; `xg-cell--num` class
  right-aligns numbers. Header mousedown uses `preventDefault()` to keep grid
  focus — toolbar must reuse this pattern. Selection lives here
  (`selRange`, `active`), not in the store, so the toolbar must be rendered
  by `ExcelGrid` and receive store + selection as props.
- `src/types.ts`: `ExcelGridProps` — add `toolbar?: boolean`.
- `src/styles.css`: `.xg-` namespaced; formula bar 28px; palette blue
  `#1a73e8` used for selection (toolbar active state will use it too).
- Tests: vitest (`GridStore.test.ts`, formula, tsv, cellRef). jsdom available.
- Verification commands: `npm run test`, `npm run typecheck`, `npm run build`;
  demo dev server via launch config `demo` (port 5199).
- Known unknown: interplay of number formats with formula error cells —
  formats must never mask `#ERR` display.

## Decisions

- **Style storage separate from `cells`**: a second sparse map
  `styles: Map<string, CellStyle>` keyed by `cellKey`. Rationale: empty cells
  can be styled (fill color), and value recompute paths stay untouched.
  Rejected: embedding style in `CellRecord` (forces record creation for
  empty-but-styled cells and complicates delete paths).
- **Undo integration via patch union**: `Patch` becomes
  `RawPatch | StylePatch` (`kind: "raw" | "style"`, style patches store
  `before/after: CellStyle | null`). `applyPatchBatch` dispatches on `kind`.
  Rejected: a separate style-undo stack (breaks single Ctrl+Z timeline —
  fails REQ).
- **`applyStyle(range, patch)`** merges a partial style into every cell in
  range (bounded by grid size and the 200k-cell cap); `undefined` fields in
  the patch leave existing values, explicit `null`-like resets are expressed
  by dedicated values (`color: undefined` via a `"unset"` marker is rejected —
  instead `applyStyle` takes `Partial<CellStyle>` where a property set to
  `undefined` **explicitly present** means "remove"; implemented with a
  key-presence check). Empty resulting style objects are deleted from the map.
- **Number formatting in `getDisplay`**: applies only when `value` is a
  number and no error; `percent` → `(v*100).toFixed(d)+"%"`, `thousands` →
  `toLocaleString("en-US")` with min/max fraction digits, plain `decimals` →
  `toFixed(d)`. Decimal +/- buttons clamp 0–10. Raw/value untouched — REQ.
- **Toolbar is an internal component** `src/components/Toolbar.tsx` rendered
  by `ExcelGrid` when `toolbar !== false`; props: `store`, `selRange`,
  `active`, `rows` (toggle states re-render because ExcelGrid re-renders on
  every store version bump). Not exported from
  `src/index.ts` — the public API is the `toolbar` prop. Rejected: exporting
  a standalone `<ExcelToolbar grid={ref}>` (needs a public store/selection
  contract; out of "简约" scope).
- **Dropdowns** (font size, colors) are simple absolutely-positioned popovers
  managed with local `useState` + outside-mousedown close; no portal, no
  external lib.
- **Toggle semantics**: toolbar reads the **active cell**'s style to decide
  pressed state and toggle direction (Excel behavior: if active cell is bold,
  action un-bolds whole range; otherwise bolds).
- **Σ quick sum**: for each selected column, write `=SUM(A1:A5)`-style raw
  into row `endRow+1` (skipped if that row exceeds grid bounds); single
  undoable `setCells` batch. Selecting a single cell sums the contiguous
  block above? Rejected — REQ says "selected columns", keep literal.
- Explicitly rejected: feature flags/env vars, format painter state machine,
  style export through `getData`, borders/merge (non-goals in REQ).

## Phased Tasks

### Phase 1 - Discovery and scope lock
- [x] Inspect `GridStore.ts` undo/redo (`Patch`, `applyPatchBatch`) to confirm
      a patch-union extension keeps one timeline. (Confirmed above.)
- [x] Inspect `ExcelGrid.tsx` selection/focus handling to confirm the toolbar
      can live inside `xg-root` and reuse mousedown-preventDefault. (Confirmed.)
- [x] Record non-goals (no export of Toolbar, no borders/merge/filter/sort,
      no format painter) in REQ/plan so implementation stays scoped.

### Phase 2 - Style model in GridStore
- [x] Add `CellStyle`, `NumFmt` (`"general" | "percent" | "thousands"`),
      `HAlign` types to `src/types.ts`; export from `src/index.ts`.
- [x] In `GridStore.ts`: add sparse `styles` map, `getStyle(row,col)`,
      `applyStyle(range, patch: StylePatchInput)` (undoable, merges, deletes
      empty style records, caps at 200,000 cells), and
      `clearFormat(range)` (undoable, removes style records).
- [x] Convert `Patch` to a `kind`-discriminated union and update
      `applyPatchBatch`, `setCells`, `undo`, `redo` so raw and style patches
      share the same stacks; style-only batches must not touch formula deps.
- [x] Extend `getDisplay(row,col)` to apply `numFmt`/`decimals` to numeric,
      non-error values only.

### Phase 3 - Toolbar component and grid wiring
- [x] Create `src/components/Toolbar.tsx`: WeCom-flat layout — undo, redo |
      clear-format | `%`, `,`, dec+, dec- | font-size dropdown | B I U S |
      text-color, fill-color palettes | align L/C/R | Σ — with Chinese
      `title` tooltips, inline SVG/text glyphs, disabled undo/redo states,
      pressed states derived from the active cell's style, and
      `onMouseDown preventDefault` so grid focus is kept.
- [x] Implement color palette + font-size popovers with outside-click close
      and a "Automatic" reset entry (presence-of-key removal semantics).
- [x] Implement Σ handler: one `store.setCells` batch writing
      `=SUM(<colLetter><startRow+1>:<colLetter><endRow+1>)` at `endRow+1` per
      selected column, skipping when `endRow+1 >= rows`.
- [x] Add `toolbar?: boolean` to `ExcelGridProps` (default true); render
      `<Toolbar/>` above the formula bar in `ExcelGrid.tsx` passing `store`,
      `selRange`, `active`, `rows`.
- [x] Render cell styles in `ExcelGrid.tsx` cell loop: fontWeight, fontStyle,
      textDecoration (underline+strike combine), fontSize, color, background,
      and justifyContent (explicit `align` overrides numeric default).
- [x] Add `.xg-toolbar` styles to `src/styles.css`: 32px flat bar, 28px hover
      buttons, `--sel`/pressed state in the existing blue, separators,
      popover styling.

### Phase 4 - Tests and verification wiring
- [x] Add `src/state/GridStore.style.test.ts`: applyStyle merge/removal,
      clearFormat, undo/redo of style batches interleaved with raw edits,
      percent/thousands/decimals display, error cells unaffected by numFmt,
      cap behavior no-op above 200k cells.
- [x] Run `npm run test` and record pass output.
- [x] Run `npm run typecheck` and `npm run build`; record results.
- [x] Verify no unintended export or dependency was added (`git diff` review
      of `package.json`, `src/index.ts`).

### Phase 5 - E2E, documentation and status
- [x] Create `.docs/tests/test-wecom-toolbar.md` E2E scenarios (see below)
      and execute them against the `demo` dev server in the browser pane.
- [x] Update `README.md` props table/features with the `toolbar` prop and
      formatting capabilities.
- [x] Update file comment blocks in every edited source file; mark plan tasks
      complete; record final evidence.

## Validation

- `npm run test` — all vitest suites pass, including new style tests.
- `npm run typecheck` — clean.
- `npm run build` — dist builds, dts emit clean.
- Browser E2E per `.docs/tests/test-wecom-toolbar.md` on `demo` (port 5199):
  screenshots of styled cells + toolbar states as evidence.

## Rollback / Risk

- Patch-union change touches the undo core; mitigated by dedicated
  interleaved undo tests. All changes additive — rollback is reverting the
  single feature commit.
- Style rendering adds per-cell inline style objects; only for cells with a
  style record (sparse), so virtualization perf is unaffected for unstyled
  sheets.
- `toolbar` default `true` changes default visuals for existing consumers;
  acceptable at 0.1.0 pre-release (documented in README).
