# Plan: Open and Save Excel (.xlsx) Files

## Goal

The library must serialize a `GridSnapshot` to a valid `.xlsx` workbook and
parse Excel-produced `.xlsx` workbooks back into a `GridSnapshot` — full
fidelity for values, formulas, number formats, styles, and column widths —
with zero new runtime dependencies, and the demo must expose Open/Save XLSX
(req: `.docs/reqs/2026/07/20/req-open-save-xlsx.md`).

## Current Context

- Component library, TypeScript, Vite 6 build, Vitest (`environment: "node"`
  in `vite.config.ts`), jsdom 25 as devDep. Node 22 locally
  (`CompressionStream`/`DecompressionStream` are globals; `DOMParser` is not —
  xlsx tests need `// @vitest-environment jsdom`).
- CSV precedent: primitives in `src/utils/tsv.ts` (`toCSV`/`parseCSV`),
  exports in `src/index.ts:32`, file wiring in `demo/main.tsx`
  (`openFile` :145 → snapshot → localStorage → epoch-bump remount;
  `saveCSV` :158 → Blob → `<a download>`; buttons :222-235; CSV
  formula-injection guard at `snapshotFromCSV` :73-81).
- Data model: `GridSnapshot { cells, styles, colWidths }` (`src/types.ts:89`),
  `CellStyle` (`types.ts:63`) with `NumFmt` union and `decimals`; cell raw
  text with `=`-prefixed formulas; dates/times/durations stored as Excel
  serial numbers (`src/utils/dateSerial.ts`).
- `GridStore` is headless-instantiable: `new GridStore(rows, cols, defaultColWidth)`
  (`src/state/GridStore.ts:132`); `setCells(changes, false)` (:388) seeds
  cells as `ExcelGrid` does at mount; `getCell()` returns evaluated
  `{raw, value, error}`; `formatNumber` (:1123) defines display semantics.
- `adjustFormula(formula, dRow, dCol, rows, cols)` (`src/formula/adjust.ts:20`)
  translates relative refs — reused to expand Excel shared formulas.
- `colWidths` are px (default 100); `CellStyle.fontSize` px (Excel pt =
  px×0.75); colors are `#rrggbb` CSS hex.
- A1 helpers in `src/utils/cellRef.ts` (`formatCellRef`, `parseCellRef`,
  `colToLetters`, `lettersToCol`).

## Decisions

- **Hand-rolled OOXML + ZIP, zero deps** (user decision). ZIP via native
  `CompressionStream("deflate-raw")`/`DecompressionStream("deflate-raw")`.
  Rejected: SheetJS (npm package stale/CVEs, CDN-only current), ExcelJS
  (first runtime dep, ~250 KB), demo-only dep (library consumers would each
  re-implement xlsx).
- **Inline strings on write** (`t="inlineStr"`): valid OOXML accepted by
  Excel/Numbers/Sheets; avoids the sharedStrings part and interning pass.
  Reader still handles `t="s"` because Excel writes sharedStrings.
- **Writer takes a bare `GridSnapshot`** and internally builds a headless
  `GridStore` to compute cached formula `<v>` values — keeps the public API
  symmetric with the CSV helpers and independent of React.
- **Styles source of truth on write**: `snapshot.styles` (not the headless
  store, whose `setCells` has an auto-date-format side effect).
- **First sheet only** on read; one sheet on write. Graceful degradation for
  theme/indexed colors and unknown format codes.
- **ZIP subset**: no zip64, no encryption, no multi-disk; reject > 512 MB or
  > 1000 entries. Read must handle method 0 (stored) and 8 (deflate); write
  always deflates. Use central-directory sizes (tolerates bit-3 data
  descriptors).
- No feature flags, no env vars, no fallback modes, no compatibility layers.
- `zip.ts` stays library-internal (not exported from `src/index.ts`).

## Phased Tasks

### Phase 1 - ZIP layer

- [x] Create `src/utils/zip.ts` with `createZip(entries): Promise<Uint8Array>`
      (CRC-32 table poly 0xEDB88320, deflate-raw via CompressionStream, local
      file headers + central directory + EOCD via little-endian `DataView`)
      and `readZip(data): Promise<Map<string, Uint8Array>>` (EOCD backscan
      over last 64 KB+22, central-directory walk, local-header re-read for
      name/extra lengths, stored + deflate methods, CRC verification, clear
      errors for encrypted/zip64/unknown-method/truncated input).
- [x] Create `src/utils/zip.test.ts` (node env): round-trip multiple
      entries (text + binary); hand-assembled stored-entry (method 0)
      fixture; foreign-deflate fixture built with `node:zlib
      deflateRawSync`; error cases (truncated EOCD, encrypted flag bit 0,
      unknown compression method).
- [x] Run `npx vitest run src/utils/zip.test.ts` and record pass.

### Phase 2 - NumFmt mapping + XLSX writer

- [x] In new `src/utils/xlsx.ts`, implement `numFmtFor(style)` (grid
      `NumFmt`+`decimals` → builtin id or custom code from id 164, deduped)
      and `numFmtToStyle(id, code?)` (builtin-id table 1-4/9-11/14-22/37-40/
      44-48 + heuristic custom-code classifier → `{numFmt, decimals}`,
      unknown → `general`), mirroring `formatNumber` semantics
      (`GridStore.ts:1123`).
- [x] Implement `snapshotToXlsx(snapshot, opts?): Promise<Uint8Array>`:
      headless `GridStore` seeded via `setCells(…, false)` for cached
      values; emit `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`
      (+rels), `xl/styles.xml` (interned fonts/fills/cellXfs; reserved
      fills 0-1; one empty `<border/>` and one `<cellStyleXfs>` xf so
      `borderId`/`xfId` refs resolve; `cellStyles` Normal entry),
      `xl/worksheets/sheet1.xml`
      (`<cols>` px→`(px-5)/7` before `<sheetData>`; cells with `r` refs,
      `s` xf indices; formulas as `<f>`+cached `<v>`/`t="str"`/`t="b"`/
      `t="e"`; strings as `inlineStr` with `xml:space="preserve"`;
      style-only cells as valueless `<c>`); XML-escape everything via a
      shared `escXml`.
- [x] Confirm generated parts round-trip through `readZip` in a quick
      writer smoke test (temporary or part of Phase 4 tests).

### Phase 3 - XLSX reader

- [x] Implement `xlsxToSnapshot(data): Promise<GridSnapshot>` in
      `src/utils/xlsx.ts` using `DOMParser` (check `parsererror`): resolve
      first sheet via `_rels/.rels` → `workbook.xml` document order →
      `xl/_rels/workbook.xml.rels` (normalize relative/absolute targets);
      honor `<workbookPr date1904>` (+1462 on date-formatted numerics).
- [x] Parse `sharedStrings.xml` (concat `<t>` descendants per `<si>`,
      decode `_xHHHH_` escapes) and `styles.xml` (numFmts/fonts/fills/
      cellXfs → per-xf `CellStyle`; pt→px rounding; `rgb` colors only,
      theme/indexed skipped; fill ≥ 2 solid → background; alignment with
      `center`→`middle` valign mapping).
- [x] Parse the sheet: `<cols>` with `customWidth` → `colWidths[c] =
      round(width*7+5)`; cells with implicit-position tracking when `r`
      absent; value types `t="s"`/`inlineStr`/`str`/`b`/`e`/numeric;
      `<f>` → raw `"="+text` preferring formula over cached value; shared
      formulas expanded via `adjustFormula` from the master's text and
      host-cell delta; apostrophe-escape plain string values starting with
      `=` (CSV-guard parity).

### Phase 4 - Tests

- [x] Create `src/utils/xlsx.test.ts` with `// @vitest-environment jsdom`
      and a guard installing `CompressionStream`/`DecompressionStream` from
      `node:stream/web` when jsdom shadows them.
- [x] Round-trip test: snapshot covering text/numbers/booleans, every
      `NumFmt` (+decimals variants), all `CellStyle` fields, colWidths,
      `=SUM` formula, error formula, style-only cell, leading-`=` string →
      write → read → compare styles/colWidths (±1 px) and display
      equivalence via a headless `GridStore` (date literals round-trip as
      serial + date format, not raw text).
- [x] Foreign-fixture test: workbook assembled in-test with `createZip`
      using sharedStrings (`t="s"`), builtin numFmtIds (14, 9, 44, 46), a
      shared-formula group (master + empty followers), a theme-colored
      font (asserts graceful skip), and one stored-method ZIP entry.
- [x] Unit tests for `numFmtFor`/`numFmtToStyle` in both directions.
- [x] Run `npx vitest run` (full suite) and record pass.

### Phase 5 - Exports and demo wiring

- [x] Add `export { snapshotToXlsx, xlsxToSnapshot } from "./utils/xlsx";`
      to `src/index.ts` beside the CSV exports; update its header comment.
- [x] Update `demo/main.tsx`: file input `accept=".csv,.xlsx,…"`, button
      label "Open…"; `openFile` reads `await file.arrayBuffer()` (NOT
      `file.text()`, which corrupts zip bytes), sniffs `PK\x03\x04` magic
      bytes (fallback: extension) and routes to `xlsxToSnapshot` in
      try/catch; the CSV path decodes the same buffer with `TextDecoder` (alert +
      keep current doc on failure); add "Save XLSX" button using
      `getSnapshot()` → `snapshotToXlsx` → Blob
      (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
      → existing `<a download>` pattern with `.xlsx` filename; update the
      demo header comment.
- [x] Run `npm run typecheck` and record pass.

### Phase 6 - E2E and manual interop verification

- [x] Execute `.docs/tests/test-open-save-xlsx.md` scenarios in the dev
      server via browser preview tools (enter data/formulas/formats, Save
      XLSX, re-open the saved file, confirm identical rendering;
      screenshot).
- [x] Open a demo-saved `.xlsx` in Numbers/Excel via `open` on this Mac
      and confirm it loads without repair warnings (record which app was
      available).
- [x] Generate or obtain an Excel/Numbers-authored workbook, open it in
      the demo, and confirm values/formats/formulas import.

## Validation

- `npx vitest run src/utils/zip.test.ts` — ZIP layer green (Phase 1).
- `npx vitest run` — full suite green including xlsx round-trip and
  foreign-fixture tests (Phase 4+).
- `npm run typecheck` — clean (Phase 5).
- Browser-preview walkthrough of the E2E spec with a screenshot of the
  reopened file (Phase 6).
- `git diff package.json` shows no `dependencies` section added.

## Rollback / Risk

- All new code is additive (`zip.ts`, `xlsx.ts`, tests, two demo hooks,
  two index exports) — rollback is deleting the new files and reverting
  the two touched files; no schema/persistence/migration impact.
- Interop risk concentrates in `styles.xml` ordering and reserved records
  (Excel "repair" warnings) — mitigated by the manual Numbers/Excel check.
- Width conversion is an approximation (Calibri-11 MDW 7 px): ±1 px
  accepted by REQ.
- Reader robustness against foreign producers (data descriptors, stored
  entries, sharedStrings) covered by fixtures; anything outside the subset
  fails with a clear error surfaced by the demo's try/catch.
