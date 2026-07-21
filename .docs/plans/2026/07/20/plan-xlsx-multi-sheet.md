# Plan: Multi-sheet support for .xlsx files

## Goal

Make `src/utils/xlsx.ts` capable of writing and reading every sheet in an `.xlsx` workbook (not just one), and give the demo app (`demo/main.tsx`) a sheet-tab UI backed by an array of sheets so a user can open, view, edit, add, rename, delete, save, and autosave a multi-sheet document without losing any sheet, per [req-xlsx-multi-sheet.md](../../../reqs/2026/07/20/req-xlsx-multi-sheet.md).

## Current Context

- `src/types.ts:89-94` — `GridSnapshot` is the sparse single-sheet shape (`cells`, `styles`, `colWidths`, `rowHeights`). Stays as the per-sheet unit; no change needed here beyond an additive `XlsxSheet` type.
- `src/utils/xlsx.ts`:
  - `snapshotToXlsx()` (line 194): builds one `<sheets>` entry (`xl/workbook.xml`, line 416) and one worksheet part `xl/worksheets/sheet1.xml` (line 449), one shared `styles.xml`. Styles/fonts/fills/numFmts are already interned per call via local `Map`s (`xfIdx`, `fontIdx`, `fillIdx`, `customCodes`) built fresh each invocation (lines 222-231) — this logic needs to be lifted so multiple sheets can share one workbook-level style table (xlsx requires exactly one `styles.xml` referenced by all sheets).
  - `xlsxToSnapshot()` (line 600): resolves only `tags(workbook, "sheet")[0]` (line 628) then parses that one worksheet part. Needs to loop over all `<sheet>` elements instead of indexing `[0]`.
  - Both functions already do the hard parts (cell/style/formula encode-decode) per sheet; multi-sheet mainly means: (a) loop the per-sheet XML generation/parsing that already exists, (b) restructure the workbook.xml/content-types/rels/zip-part lists to reference N worksheet parts, (c) share one styles.xml across sheets in the writer.
  - `XlsxOptions.sheetName` (line 180-183) is the only sheet-naming knob today.
- `src/index.ts:26` exports `snapshotToXlsx`, `xlsxToSnapshot`, `XlsxOptions` — these signatures must not change (REQ constraint: backward compatible).
- `demo/main.tsx`:
  - `DocState` (lines 36-41) holds one `snapshot: GridSnapshot | null` and an `epoch` used as the `ExcelGrid` React `key` to force remount on document swap (line 281: `key={doc.epoch}`). This remount-on-key pattern is the mechanism to reuse for sheet switching (swapping `initialState` alone would not reset an existing `GridStore`).
  - `loadInitialDoc()` / `persistNow()` / `fileKey()` (lines 43-58, 102-111, 31) — localStorage schema keyed by file name, storing one JSON `GridSnapshot`. Needs to become one JSON array of named sheets + active sheet.
  - `openFile()` (line 149): xlsx branch calls `xlsxToSnapshot(bytes)` (line 161); CSV branch calls `snapshotFromCSV` (line 168) — both produce a single `GridSnapshot` that becomes the whole doc. Needs to produce a sheets array (xlsx: all sheets; CSV: one sheet).
  - `saveXLSX()` (line 203): calls `snapshotToXlsx(snapshot)` on the single active-sheet snapshot. Needs to gather all sheets (with any pending edits to the active one flushed into its snapshot first) and call the new multi-sheet writer.
  - No sheet-tab UI exists anywhere in the header (lines 256-278).
- No test currently exercises multiple `<sheet>` elements in a workbook (`src/utils/xlsx.test.ts` — single-sheet only, confirmed by REQ investigation).
- Vitest (`npm test` → `vitest run`) and `tsc --noEmit` (`npm run typecheck`) are the verification commands (from `package.json`).

## Decisions

- Keep `GridSnapshot` as the per-sheet unit (REQ constraint). Add a new `XlsxSheet` type `{ name: string; snapshot: GridSnapshot }` in `src/types.ts` next to `GridSnapshot`, exported from `src/index.ts`. Rejected: embedding an array inside `GridSnapshot` — would break the REQ constraint and every existing single-sheet consumer/type.
- Add `workbookToXlsx(sheets: XlsxSheet[], opts?)` and `xlsxToWorkbook(data): Promise<XlsxSheet[]>` in `src/utils/xlsx.ts` as the new multi-sheet API. Reimplement `snapshotToXlsx`/`xlsxToSnapshot` as thin wrappers: `snapshotToXlsx(snapshot, opts) = workbookToXlsx([{ name: opts.sheetName ?? "Sheet1", snapshot }])`; `xlsxToSnapshot(data) = (await xlsxToWorkbook(data))[0].snapshot`. This satisfies the "unchanged signature/behavior" acceptance criterion by construction rather than by maintaining two parallel code paths.
- Writer: refactor the per-sheet cell/style-collection block (current lines 200-390) into a helper that, given one `GridSnapshot`, returns `{ sheetXml, cellStyles: CellStyle[] used }`; hoist `internXf`/`fonts`/`fills`/`customCodes`/`xfs` to workbook scope so all sheets intern into one shared `styles.xml`. Each sheet gets its own worksheet part `xl/worksheets/sheetN.xml`, its own `<sheet name="..." sheetId="N" r:id="rIdN"/>` entry, its own content-types override and workbook.xml.rels relationship; `styles.xml` stays singular and shared.
- Reader: refactor the "resolve first `<sheet>` -> parts -> parse" block (current lines 625-763) into a per-sheet parse helper; loop `tags(workbook, "sheet")` (not just `[0]`) and resolve each one's worksheet part via its own `r:id`. Shared strings and `styles.xml` are workbook-level already (parsed once, reused per sheet) — no change needed there beyond calling the shared/style parse once and passing results into the per-sheet loop.
- Sheet names: writer must XML-escape and keep caller-supplied names as-is (already does via `escXml`); if the caller passes duplicate/empty names, write them verbatim (no dedup/validation) — Excel tolerates it for reading, and enforcing uniqueness is a demo-app UI concern, not a library concern. Reader returns whatever name is on each `<sheet>` element, defaulting to `"Sheet" + (index+1)` only if the attribute is literally missing.
- Demo app data model: replace `DocState.snapshot: GridSnapshot | null` with `DocState.sheets: XlsxSheet[]` and `DocState.activeIndex: number`. Rejected: keeping a `Record<string, GridSnapshot>` keyed by name — an ordered array matches xlsx sheet order and tab order directly and avoids a separate order list.
- Sheet switching reuses the existing `epoch`-as-remount-key pattern: before switching, capture `gridRef.current?.getSnapshot()` into `sheets[activeIndex]`, bump `epoch`, set new `activeIndex`, and let `ExcelGrid` remount with `initialState={sheets[activeIndex].snapshot}`. Rejected: keeping one long-lived `ExcelGrid`/`GridStore` and hot-swapping its internal state — `GridStore` has no public "replace all state" API beyond full remount via `initialState`, and remount is already the app's established pattern for document swaps.
- Persistence schema: change the stored JSON at `fileKey(name)` from a bare `GridSnapshot` to `{ sheets: XlsxSheet[], activeIndex: number }`. This is a breaking localStorage format change; REQ has no compatibility requirement for old autosave entries, and old-format JSON simply fails the new shape check and falls back to a blank document (same fallback the code already does for corrupt JSON) — no migration code needed. Rejected: writing a versioned/dual-format reader — unnecessary complexity for a local demo cache with no external consumers.
- Sheet-tab UI: a plain row of buttons above the grid (reuse the existing inline-style button pattern already used for New/Open/Save), one per sheet name, plus a "+" add-sheet button. Active tab highlighted via style; double-click (or a small rename affordance) triggers `window.prompt` for rename (consistent with the existing `window.confirm`/`window.alert` usage in this demo for New/Open-failure); delete via a small "×" on each tab, blocked (no-op) when only one sheet remains. Rejected: a dedicated `SheetTabs` component in `src/components/` — this is demo-app orchestration UI, not part of the reusable `ExcelGrid` library surface (REQ constraint: `ExcelGrid`/`GridStore` stay single-sheet), so it belongs in `demo/main.tsx` alongside the other header controls.
- No cross-sheet formulas, no tab color/freeze-pane metadata, no drag-reorder — explicit REQ non-goals, not implemented.

## Phased Tasks

### Phase 1 - Discovery and scope lock
- [ ] Re-confirm in `src/utils/xlsx.ts` that `internXf`/`fonts`/`fills`/`customCodes`/`xfs` (lines 222-298) are the only per-call mutable style-interning state, so hoisting them to workbook scope is sufficient for sheet-shared styles.
- [ ] Re-confirm in `src/utils/xlsx.ts` reader that shared strings (`sstDoc`, line 645) and `stylesDoc`/`xfInfos` (lines 652-654) are already parsed once from workbook-level parts, independent of which sheet is being read, so they can be reused unchanged across a per-sheet loop.
- [ ] Record that `ExcelGrid`/`GridStore` must not be touched — multi-sheet orchestration is confined to `src/utils/xlsx.ts`, `src/types.ts`, `src/index.ts`, and `demo/main.tsx`.

### Phase 2 - Library: shared types
- [ ] Add `export interface XlsxSheet { name: string; snapshot: GridSnapshot }` to `src/types.ts` next to `GridSnapshot` (after line 94), with a one-line doc comment.
- [ ] Export `XlsxSheet` from `src/index.ts` alongside the existing type exports (after `GridSnapshot` in the `export type { ... } from "./types"` block, line ~18-23).

### Phase 3 - Library: multi-sheet writer
- [ ] In `src/utils/xlsx.ts`, extract the per-sheet body of `snapshotToXlsx` (used-range scan, headless `GridStore` eval, `colsXml`/`rowsXml` construction, currently lines 200-390) into a helper `buildSheetXml(snapshot: GridSnapshot, internXf: (style: CellStyle) => number): string` that takes the style-interning function as a parameter instead of building it locally.
- [ ] Add `workbookToXlsx(sheets: XlsxSheet[]): Promise<Uint8Array>` that hoists `customCodes`/`fonts`/`fontIdx`/`fills`/`fillIdx`/`xfs`/`xfIdx`/`internXf` once (workbook scope), calls `buildSheetXml` per sheet to get each `sheetXml`, and emits: one `[Content_Types].xml` override per worksheet part, one `<sheet>` entry per sheet in `xl/workbook.xml` with sequential `sheetId`/`r:id`, one relationship per worksheet in `xl/_rels/workbook.xml.rels` (plus the existing styles relationship), one shared `xl/styles.xml`, and `xl/worksheets/sheet{1..N}.xml` parts — all passed to `createZip`.
- [ ] Reimplement `snapshotToXlsx(snapshot, opts)` as `workbookToXlsx([{ name: opts.sheetName ?? "Sheet1", snapshot }])`, keeping its exported signature (`Promise<Uint8Array>`) and the `XlsxOptions` type unchanged.
- [ ] Confirm empty-`sheets`-array input to `workbookToXlsx` is not a case the demo can produce (UI always keeps >=1 sheet per REQ); no special-case handling needed beyond what falls out naturally (skip if it doesn't compile cleanly, since Excel requires >=1 sheet — this is enforced at the demo-app UI layer, not the library).

### Phase 4 - Library: multi-sheet reader
- [ ] In `src/utils/xlsx.ts`, extract the per-sheet body of `xlsxToSnapshot` (worksheet-part resolution via `r:id`, column widths, row/cell loop, currently lines 625-763) into a helper `parseSheetXml(sheet: Element, xfInfos: XfInfo[], sharedStrings: string[], date1904: boolean): GridSnapshot`.
- [ ] Add `xlsxToWorkbook(data: ArrayBuffer | Uint8Array): Promise<XlsxSheet[]>` that parses workbook/rels/shared-strings/styles once (as `xlsxToSnapshot` already does), then iterates every `tags(workbook, "sheet")` element (not just index `[0]`), resolves each one's worksheet part via its own `r:id`/relationship, calls `parseSheetXml`, and collects `{ name: sheetEl.getAttribute("name") ?? "Sheet" + (i+1), snapshot }` in document order. Throw the existing `"xlsx: worksheet part not found"` error only for a sheet that fails to resolve, not for the whole workbook.
- [ ] Reimplement `xlsxToSnapshot(data)` as `(await xlsxToWorkbook(data))[0].snapshot`, keeping its exported signature (`Promise<GridSnapshot>`) unchanged. In `xlsxToWorkbook`, throw `"xlsx: worksheet part not found"` explicitly when `tags(workbook, "sheet")` is empty, so `xlsxToSnapshot` never indexes `[0]` on an empty array (avoids a raw `TypeError` for a zero-sheet workbook).
- [ ] Export `workbookToXlsx` and `xlsxToWorkbook` from `src/index.ts` alongside `snapshotToXlsx`/`xlsxToSnapshot` (line 26).

### Phase 5 - Demo app: multi-sheet document model
- [ ] In `demo/main.tsx`, change `DocState` (lines 36-41) to `{ fileName: string; sheets: XlsxSheet[]; activeIndex: number; epoch: number }`, importing `XlsxSheet` from `../src/index`.
- [ ] Update `loadInitialDoc()` (lines 43-58) to parse the new persisted shape `{ sheets: XlsxSheet[], activeIndex: number }` from `localStorage`, validating `Array.isArray(sheets) && sheets.length > 0`; fall back to `{ fileName, sheets: [{ name: "Sheet1", snapshot: blank }], activeIndex: 0, epoch: 0 }` (a single blank sheet, matching current blank-doc behavior) when missing/invalid.
- [ ] Update `persistNow()` (lines 102-111) to first write the live grid's snapshot into `sheets[activeIndex]` via `gridRef.current?.getSnapshot()`, then `JSON.stringify({ sheets, activeIndex })` to `fileKey(doc.fileName)`.
- [ ] Update `gridSize()` (lines 61-75) call sites to compute sizing from `doc.sheets[doc.activeIndex].snapshot` instead of `doc.snapshot`.
- [ ] Update `snapshotFromCSV` usage in `openFile()`'s CSV branch to wrap its result as `[{ name: "Sheet1", snapshot: snapshotFromCSV(text) }]`.

### Phase 6 - Demo app: sheet-tab UI and actions
- [ ] Add a helper `flushActiveSheetEdits(doc: DocState): XlsxSheet[]` (or inline in the switch handler) that captures `gridRef.current?.getSnapshot()` into a copy of `doc.sheets[doc.activeIndex]` before any action that swaps the visible grid (sheet switch, open, new).
- [ ] Add `switchSheet(index: number)`: flush the active sheet's edits, then `setDoc(d => ({ ...d, sheets: flushed, activeIndex: index, epoch: d.epoch + 1 }))`.
- [ ] Add `addSheet()`: flush active edits, append `{ name: nextDefaultName(doc.sheets), snapshot: blank }` (helper `nextDefaultName` picks `"SheetN"` not already used), set `activeIndex` to the new sheet, bump `epoch`.
- [ ] Add `renameSheet(index: number)`: `window.prompt` for a new name seeded with the current name; on non-empty, non-cancelled input, update `sheets[index].name` (no remount needed — name change doesn't affect the grid).
- [ ] Add `deleteSheet(index: number)`: no-op when `doc.sheets.length <= 1`; otherwise remove that sheet, clamp `activeIndex` into range, bump `epoch` if the removed or a lower-indexed sheet was active.
- [ ] Render a sheet-tab row (new `<div>` between the header button row and the grid, around line 279) mapping `doc.sheets` to buttons: click calls `switchSheet(i)`, double-click calls `renameSheet(i)`, an adjacent small "×" control calls `deleteSheet(i)` (hidden/disabled when `sheets.length === 1`), plus a trailing "+" button calling `addSheet()`. Highlight the tab at `activeIndex`.
- [ ] Update `openFile()`'s xlsx branch (line 161) to call `xlsxToWorkbook(bytes)` and set `sheets`/`activeIndex: 0` from the full result instead of `xlsxToSnapshot`.
- [ ] Update `saveXLSX()` (line 203) to flush the active sheet's edits into `sheets[activeIndex]`, then call `workbookToXlsx(sheets)` instead of `snapshotToXlsx(snapshot)`.
- [ ] Update `newGrid()` (line 226) to reset to a single blank sheet (`sheets: [{ name: "Sheet1", snapshot: blank }], activeIndex: 0`).
- [ ] Update the `<ExcelGrid>` usage (lines 280-288) to read `initialState={doc.sheets[doc.activeIndex]?.snapshot}` instead of `doc.snapshot`.

### Phase 7 - Tests and verification wiring
- [ ] Add tests in `src/utils/xlsx.test.ts` for `workbookToXlsx`/`xlsxToWorkbook`: (a) round-trip a 3-sheet workbook (distinct names, distinct cell content per sheet) and assert sheet count, names in order, and per-sheet cell content; (b) assert `snapshotToXlsx`/`xlsxToSnapshot` still behave identically to their pre-change single-sheet contracts (existing tests in this file should keep passing unmodified — run them as the check); (c) assert styles defined on different sheets are correctly shared/interned into one `styles.xml` without cross-sheet bleed (a style used only on sheet 2 must render as that style when read back, not leak onto sheet 1's cells).
- [ ] Run `npx vitest run src/utils/xlsx.test.ts` and record pass/fail.
- [ ] Run `npm test` (full suite) and record pass/fail; fix any regression in `src/utils/xlsx.test.ts` or elsewhere caused by the refactor.
- [ ] Run `npm run typecheck` and record pass/fail; fix any type errors from the `demo/main.tsx` and `src/utils/xlsx.ts`/`src/types.ts` changes.
- [ ] Verify (by reading the final `demo/main.tsx`) that no dead code remains from the old single-`snapshot` `DocState` shape (no leftover `doc.snapshot` references).

### Phase 8 - Documentation and status
- [ ] Update the file-comment blocks in `src/utils/xlsx.ts`, `src/types.ts`, `src/index.ts`, and `demo/main.tsx` to describe the new multi-sheet functions/types/UI and the persistence schema change, per RPD's file-comment-block convention.
- [ ] Update `README.md` if it documents `snapshotToXlsx`/`xlsxToSnapshot` or the demo's file actions, to mention multi-sheet support and the new `workbookToXlsx`/`xlsxToWorkbook` exports (check `README.md` for existing xlsx mentions first; skip if none exist).
- [ ] Record final evidence (test output, typecheck output, and a manual open/switch/add/rename/delete/save walkthrough note) showing every REQ acceptance criterion is satisfied.

## Validation

- `npx vitest run src/utils/xlsx.test.ts` — new multi-sheet round-trip tests pass; existing single-sheet tests in the same file pass unmodified.
- `npm test` (full `vitest run`) — no regressions in `GridStore`/`formula`/`tsv`/`zip`/`cellRef`/`dateSerial` suites.
- `npm run typecheck` — clean `tsc --noEmit` across `src/` and `demo/`.
- Manual/browser check (dev server `npm run dev`): open a multi-sheet `.xlsx` fixture (create one via `workbookToXlsx` in a scratch script, or use any real multi-tab Excel file) and confirm all tabs appear; switch tabs and confirm content differs per sheet and edits persist across a switch; add/rename/delete a sheet; Save XLSX and re-open the saved file to confirm round-trip; reload the page and confirm autosave restored all sheets and the active tab.

## Rollback / Risk

- **Risk**: hoisting style interning to workbook scope in the writer could change generated `s="N"` indices for the existing single-sheet path, which is safe (indices are internal, not part of any external contract) but worth confirming existing `xlsx.test.ts` assertions don't hardcode specific style indices — read the test file during Phase 3 before assuming this is risk-free.
- **Risk**: the reader's shared-formula master lookup (`sharedMasters`, `src/utils/xlsx.ts:675`) is currently function-local to `xlsxToSnapshot`'s single parse; when extracted into `parseSheetXml` it must be re-initialized per sheet (shared formulas don't cross worksheet parts in OOXML) — call this out explicitly in Phase 4 so the extraction doesn't accidentally hoist it to workbook scope.
- **Data-loss risk**: the localStorage schema change (Phase 5) makes old single-snapshot autosave entries unreadable by the new code; mitigated by the existing "corrupt JSON -> blank document" fallback already in `loadInitialDoc()`, and acceptable per REQ (no migration requirement) since this is a local dev demo, not a shipped product with real user data.
- **Rollback**: all changes are additive-or-refactor within `src/utils/xlsx.ts`, `src/types.ts`, `src/index.ts`, `demo/main.tsx`; reverting the commit(s) fully restores single-sheet behavior with no migration concerns (no schema/DB changes outside localStorage, which self-heals via the corrupt-JSON fallback).
