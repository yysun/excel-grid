# Plan: grid-persistence

## Goal

The demo app must autosave full grid state (cell raws, styles, column
widths) to localStorage keyed by a tracked file name after every edit,
restore it on load (blank grid when absent), and offer Open CSV / Save CSV /
New buttons — with the library gaining only the minimal additive snapshot /
notification API this needs.

## Current Context

- Library: `src/state/GridStore.ts` holds all sheet state. `cells`,
  `styles`, `colWidths` are private; public reads exist per cell
  (`getCell`, `getStyle`, `getColWidth`) and `getAllCells()`, but there is
  no bulk style/width accessor and no non-undoable style initializer
  (`applyStyle` is undoable + capped). `notify()` runs on every mutation
  (data, style, width, structure, view state) and calls `listeners`;
  `onChange` fires only when cell values changed — style/width edits notify
  with `changes: []`, so `onChange` alone cannot drive autosave.
- `src/components/ExcelGrid.tsx` creates the store once in a ref
  (`storeRef`), seeds it from `initialCells` via `setCells(changes, false)`,
  and exposes `ExcelGridHandle` (`getCell`/`setCell`/`getData`) via
  `useImperativeHandle`. `useSyncExternalStore(store.subscribe, ...)` shows
  the subscription pattern to reuse for `onStateChange`.
- `src/types.ts` defines `CellStyle`, `ExcelGridProps`, `ExcelGridHandle`.
  `src/index.ts` is the public export surface.
- `src/utils/tsv.ts` already implements quote-aware delimiter
  encode/parse, but hardcodes `\t`; CSV needs the same logic with `,`.
- Demo `demo/main.tsx` imports `accounts-6.json` and builds ~1,400 rows of
  `initialCells`; it must be rewritten around localStorage + file actions.
  `colToLetters`/`parseCellRef` are already exported for ref math.
- Verification commands: `npm run typecheck`, `npm test` (vitest),
  `npm run build`; dev server `npm run dev` (vite, demo/vite.config.ts).
- Known unknown: none blocking; snapshot JSON size for large sheets is
  bounded by demo scale (~20k cells → well under localStorage quota).

## Decisions

- **Snapshot shape** (`GridSnapshot`, exported from `types.ts`):
  `{ cells: Record<string, string>; styles: Record<string, CellStyle>;
  colWidths: Record<number, number> }` — cells/styles keyed by A1 ref,
  colWidths by zero-based column index. View state (filters, hidden,
  frozen, search) is excluded per REQ non-goals; undo history is not
  serialized.
- **Library API additions (all additive)**: prop `initialState?:
  GridSnapshot` (applied at store creation after `initialCells`), prop
  `onStateChange?: () => void` (fired on every store notify — covers data,
  style, width, and structural edits), handle method `getSnapshot():
  GridSnapshot`. Rejected: a library-side persistence layer, storage
  adapters, an `onStyleChange` twin callback, and any feature
  flag/env-var gating — the single generic callback is enough.
- **GridStore additions**: `getSnapshot(): GridSnapshot` (built in the
  store so it is unit-testable without React), `initStyle(row, col,
  style)` (sets a style record directly: not undoable, no notify —
  documented as pre-render initialization only), and a `display` field
  added to `getAllCells()` entries (via the existing `getDisplay`) so the
  demo can export formatted text. Rejected: making the private maps
  public or adding a store-level load/replace method; the demo swaps
  state by remounting `ExcelGrid` with a React `key`, which reuses the
  existing construction path and keeps undo history trivially correct
  (empty).
- **CSV utils**: refactor `src/utils/tsv.ts` internals to take a delimiter
  parameter and export `toCSV(rows)` / `parseCSV(text)` beside
  `toTSV`/`parseTSV` (quote when the cell contains delimiter, quote, or
  newline; RFC-4180 double-quote escapes; rows joined with `\n` like the
  existing TSV writer — LF output is accepted by Excel/Sheets and CRLF is
  handled on parse). Re-export CSV helpers from `src/index.ts`. Rejected:
  a separate near-duplicate csv.ts parser.
- **CSV export semantics** (revised per AR finding): Save CSV writes the
  used range's *displayed text* (`getData().display`, empty cells → "").
  Formulas export their computed result, number formats (currency, date,
  etc.) are applied, booleans render TRUE/FALSE, error cells export their
  code — matching what Excel writes when saving a sheet as CSV. Raw
  values would leak date serials (e.g. `46000`); rejected. Full fidelity
  is localStorage's job (REQ non-goal).
- **CSV import safety**: imported fields starting with `=` are prefixed
  with `'` (same convention as the old JSON demo import). Note the grid
  has no apostrophe-hiding logic: such a cell *displays* the leading `'`.
  Accepted — the point is only that foreign CSV data never executes as a
  formula; the E2E spec states this expectation explicitly.
- **Demo persistence**: keys `excel-grid-demo:file:{fileName}` (snapshot
  JSON) and `excel-grid-demo:current` (last file name, so reload reopens
  the same file). Boot never writes localStorage; `:current` and the file
  entry are written by autosave, Open, and New only. Autosave =
  `onStateChange` → 300 ms debounce → `getSnapshot()` → `setItem`;
  `pagehide` and `visibilitychange`→hidden listeners flush the pending
  save so reloads/tab kills never lose the last edit. Corrupt or
  unparseable stored JSON falls back to a blank grid (try/catch), no
  migration layer.
- **Demo file actions**: header buttons `New`, `Open CSV…` (hidden
  `<input type="file" accept=".csv,text/csv">` + `file.text()`), and
  `Save CSV` (Blob + temporary `<a download>`; no File System Access
  API). `New` runs `window.confirm` first, removes the default-name
  entry, resets the name to `untitled.csv`. Grid remounts use an `epoch`
  counter as the React key. Default blank grid: 1000 rows × 26 cols;
  opened CSVs size to `max(1000, rows+100)` × `max(26, cols+2)`.
- The bundled `accounts-6.json` import, `buildCells`, and column-alias
  table are removed from `demo/main.tsx` (the JSON file stays on disk).
  The onChange event log stays.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect `GridStore.ts` (`styles`, `colWidths`, `notify`,
      `applyStyle`) and `ExcelGrid.tsx` (store construction,
      `useImperativeHandle`) to confirm no existing bulk accessors or
      non-undoable style path exist. (Done during AP inspection.)
- [x] Confirm `tsv.ts` parse/encode logic generalizes by delimiter with no
      behavior change for TSV. (Done: `\t` appears only in the char tests
      and the join/split delimiter.)
- [x] Record non-goals: no library persistence, no File System Access
      API, no CSV formula/style fidelity, no view-state persistence, no
      snapshot versioning/migration. (Captured in Decisions above.)

### Phase 2 - Library foundation (types, store, CSV utils)

- [x] Add `GridSnapshot` to `src/types.ts`; extend `ExcelGridProps` with
      `initialState?: GridSnapshot` and `onStateChange?: () => void`;
      extend `ExcelGridHandle` with `getSnapshot(): GridSnapshot` and add
      `display: string` to the `getData()` entry type (additive).
- [x] In `src/state/GridStore.ts`, add `getSnapshot(): GridSnapshot`
      (cells raw by A1 ref, styles by A1 ref, colWidths by index),
      `initStyle(row, col, style)` (direct style record write; no undo
      patch, no notify; doc comment states the initialization-only
      contract), and a `display` field on `getAllCells()` entries.
- [x] Refactor `src/utils/tsv.ts` to delimiter-parameterized
      `encodeCell`/`parseDelimited` internals and export
      `toCSV`/`parseCSV`; keep `toTSV`/`parseTSV` signatures identical.
- [x] Export `GridSnapshot`, `toCSV`, `parseCSV` from `src/index.ts`.

### Phase 3 - ExcelGrid wiring

- [x] In `ExcelGrid.tsx` store construction, apply `initialState` after
      `initialCells`: cells via `setCells(changes, false)`, styles via
      `initStyle`, widths via `setColWidth` (safe pre-subscription;
      coerce JSON-round-tripped colWidth keys with `Number(k)`).
- [x] Expose `getSnapshot()` in `useImperativeHandle` (delegating to
      `store.getSnapshot()`) and pass the new `display` field through
      `getData()`.
- [x] Subscribe an effect to `store.subscribe` that invokes the latest
      `onStateChange` (ref-held so resubscription isn't needed per
      render), and confirm no other behavior changed for existing props.

### Phase 4 - Demo app rewrite

- [x] Rewrite `demo/main.tsx`: remove `accounts-6.json` import,
      `buildCells`, and the alias table; on boot read
      `excel-grid-demo:current` + its snapshot entry (try/catch → blank
      1000×26 grid, name `untitled.csv`).
- [x] Implement autosave: `onStateChange` → 300 ms debounced
      `getSnapshot()` → `localStorage.setItem(fileKey(fileName), json)`
      plus `excel-grid-demo:current`; flush pending save on `pagehide`.
- [x] Implement `Open CSV…` (hidden file input, `parseCSV(await
      file.text())`, `'`-escape leading `=`, build `cells` keyed by A1,
      set file name to `file.name`, bump epoch, persist immediately).
- [x] Implement `Save CSV` (used range from `getData()` refs via
      `parseCellRef`, cell `display` text into the matrix, `toCSV`, Blob
      download named `fileName`).
- [x] Implement `New` (confirm → remove default-name entry, reset name,
      blank snapshot, bump epoch) and render the current file name +
      buttons in the header row.

### Phase 5 - Tests and verification

- [x] Add CSV cases to `src/utils/tsv.test.ts` (or sibling describe):
      `toCSV` quoting of comma/quote/newline, `parseCSV` of quoted fields
      with embedded commas/newlines/`""` escapes, round-trip, and TSV
      regression (existing tests still pass unchanged).
- [x] Add GridStore tests covering: `getSnapshot` returning cells +
      styles + colWidths after `setCells`/`applyStyle`/`setColWidth`;
      `initStyle` (no undo entry, visible via `getStyle` and
      `getSnapshot`); `subscribe` listener firing on a style-only edit
      and a width-only edit (the `onStateChange` contract); and
      `getAllCells().display` applying number formats.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`; record exact
      results.
- [x] Verify removal: `accounts-6.json` no longer referenced from
      `demo/main.tsx` (grep) so the sample data cannot auto-load.

### Phase 6 - E2E and docs

- [x] Execute `.docs/tests/test-grid-persistence.md` scenarios against
      `npm run dev` with the in-app browser (localStorage inspected via
      JS), fixing any failures.
- [x] Update file comment blocks in every touched source file and record
      final evidence against the REQ acceptance criteria.

## Validation

- `npm run typecheck` → exits 0.
- `npm test` → all vitest suites pass, including new CSV + snapshot tests.
- `npm run build` → dist build succeeds (library exports compile).
- E2E per `.docs/tests/test-grid-persistence.md`: edit/style/resize →
  localStorage JSON updates; reload restores; empty storage → blank grid;
  Open CSV populates grid + renames; New clears; Save CSV path exercised
  (CSV text correctness proven by unit tests).
- Evidence to report: command outputs, localStorage JSON excerpts, and
  browser screenshots/text reads of the restored grid.

## Rollback / Risk

- All library changes are additive; existing consumers are unaffected. A
  revert of the demo commit restores the accounts-based demo.
- `onStateChange` fires on view-state notifies too (search/filter/freeze),
  causing redundant but idempotent saves — accepted for simplicity.
- Save CSV for boolean cells emits TRUE/FALSE and for error cells emits
  the error code (both via display text) — documented behavior, covered
  by the display-field unit test.
- localStorage quota: demo-scale snapshots are ~1–2 MB worst case;
  `setItem` is wrapped in try/catch so quota errors surface in console
  without crashing editing.
- No data migration concerns (new storage keys, throwaway demo data).
