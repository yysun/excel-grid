# Requirement: Open and Save Excel (.xlsx) Files

## Problem

The grid can only exchange files as CSV, which carries display text alone:
formulas, number formats, cell styles, and column widths are all lost on save
and absent on open. Users working with real spreadsheets need to open
Excel-produced `.xlsx` workbooks in the grid and save grid documents as
`.xlsx` files that Excel/Numbers/Google Sheets accept, without losing the
grid's formatting and formula state.

## Requirement

- The library exposes two public async helpers, mirroring the existing CSV
  helpers' role as host-app primitives:
  - `snapshotToXlsx(snapshot, opts?)` — serializes a `GridSnapshot` to a
    valid `.xlsx` workbook (bytes).
  - `xlsxToSnapshot(data)` — parses an `.xlsx` workbook (first worksheet)
    into a `GridSnapshot`.
- The implementation adds **no runtime dependencies**; the library continues
  to ship with zero production dependencies. The ZIP layer uses the
  platform's native `CompressionStream`/`DecompressionStream`.
- Fidelity (both directions, to the extent each side can represent it):
  cell values (text, numbers, booleans), formulas (raw text preserved),
  number formats (all `NumFmt` variants incl. decimals), cell styles
  (bold/italic/underline/strike, font size, text color, background,
  horizontal/vertical alignment, wrap), and column widths.
- Saved files open correctly in Excel/Numbers (valid OOXML: required parts,
  reserved style records, cached formula values).
- Files saved by Excel itself open correctly: shared strings, shared
  formulas, stored and deflated ZIP entries, builtin number-format ids.
- The demo app's Open action accepts `.xlsx` in addition to `.csv`
  (detected by content, not just extension) and gains a "Save XLSX" action,
  reusing the existing localStorage-persistence and remount flow.
- Plain string cell values beginning with `=` in an imported file must not
  execute as formulas (same apostrophe-escape guard as the CSV import path).

## Acceptance Criteria

- [x] `snapshotToXlsx` and `xlsxToSnapshot` are exported from the library
      entry point and typed against `GridSnapshot`. Evidence:
      [src/index.ts](../../../../../src/index.ts) exports both plus
      `XlsxOptions`.
- [x] `package.json` still has no `dependencies` entry (zero runtime deps).
      Evidence: `git diff package.json` shows no changes; `dependencies`
      key remains absent.
- [x] A snapshot containing text, numbers, booleans, formulas (including an
      error-producing one), every `NumFmt` (with decimals variants), every
      `CellStyle` field, a style-only empty cell, and custom column widths
      round-trips through save→open with equivalent display values, styles,
      and widths (±1 px width tolerance). Evidence:
      `src/utils/xlsx.test.ts` round-trip test (189/189 suite passing);
      confirmed live in-browser via a real save→open cycle in the demo
      (pixel-identical rendering, screenshot compared).
- [x] A fixture workbook using Excel conventions — sharedStrings (`t="s"`),
      shared formulas (`t="shared"` master + followers), builtin numFmtIds
      (date/percent/currency/duration), a ZIP entry stored uncompressed —
      imports into the expected snapshot. Evidence:
      `src/utils/xlsx.test.ts` foreign-fixture test; additionally verified
      against a genuinely independent producer (Python openpyxl 3.1.5,
      real deflate + sharedStrings + styles.xml) opened live in the demo
      with correct values/styles/formats.
- [x] Imported plain strings starting with `=` arrive apostrophe-escaped.
      Evidence: unit test in `xlsx.test.ts`; confirmed live in the demo
      (cell displayed `'=2+2` literally, not evaluated).
- [x] Demo: Open… accepts a `.xlsx` file (sniffed via PK magic bytes) and
      renders it; Save XLSX downloads a `.xlsx` named after the current
      file. Evidence: `demo/main.tsx` `openFile`/`saveXLSX`; a `.txt`
      renamed `.xlsx` (no PK magic) falls back to the CSV path, confirmed
      live.
- [x] A file saved from the demo opens without repair warnings in
      Excel or Numbers on this machine (manual check). Evidence: saved
      bytes opened via `open -a "Microsoft Excel"` and `open -a Numbers`;
      both apps' own AppleScript dictionaries read cell values, formulas,
      the live-recalculated formula result, and the currency number
      format directly (Excel: `hello`, `1234.5`, `2469.0`
      `=SUM(B1:B1)*2`, date `1/5/2024`, `true`, `=1/0`; format
      `$#,##0.00;"-$"#,##0.00`) — no repair dialog blocked scripted
      access in either app.
- [x] `npm run typecheck` and `npm test` pass. Evidence: `tsc --noEmit`
      clean; `npx vitest run` 189/189 passing.

## Constraints

- Zero runtime dependencies (hand-rolled OOXML + ZIP; native
  `CompressionStream("deflate-raw")`, available in target browsers and
  Node ≥ 18 — local toolchain is Node 22).
- First worksheet only on import; one worksheet on export.
- Dates/times/durations already use Excel serial numbers internally
  (`src/utils/dateSerial.ts`) and must map through unchanged.
- Graceful degradation, never hard failure, for unsupported style inputs
  (theme/indexed colors, unknown format codes → closest `NumFmt` or
  `general`).
- Unknown Excel functions may evaluate to `#NAME?` in-grid, but the raw
  formula text must survive and re-export intact.

## Non-Goals

- Multiple sheets, merged cells, row heights, borders, rich text runs
  (concatenated to plain text), images/charts, defined names, zip64,
  encrypted workbooks, `.xls` (BIFF) format.
- No SheetJS/ExcelJS or any other new dependency, including dev-only
  polyfills beyond the existing test setup.
- No feature flags or alternate code paths; xlsx support is always on.
