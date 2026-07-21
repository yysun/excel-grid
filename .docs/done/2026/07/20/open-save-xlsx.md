# Open and Save Excel (.xlsx) Files

## Summary

- Added zero-dependency Excel `.xlsx` open/save to the grid library: a
  minimal ZIP reader/writer ([src/utils/zip.ts](../../../../src/utils/zip.ts))
  using native `CompressionStream`/`DecompressionStream`, and an OOXML
  serializer/parser ([src/utils/xlsx.ts](../../../../src/utils/xlsx.ts))
  converting `GridSnapshot` ↔ `.xlsx` bytes.
- Full fidelity: values, formulas (with cached results computed by a
  headless `GridStore`), every `NumFmt` (builtin + custom number-format
  codes, both directions), cell styles, and column widths.
- Reader handles real Excel conventions: shared strings, shared formulas
  (expanded via the existing `adjustFormula`), builtin numFmt ids, rich-text
  runs, `date1904`, and degrades gracefully on theme/indexed colors and
  unrecognized format codes instead of failing.
- New public exports `snapshotToXlsx`/`xlsxToSnapshot` from
  [src/index.ts](../../../../src/index.ts); the library still has zero
  runtime dependencies.
- Demo ([demo/main.tsx](../../../../demo/main.tsx)): Open… now
  content-sniffs `.xlsx` by PK magic bytes (never by extension — a
  `.txt` renamed `.xlsx` correctly falls back to CSV) and reads via
  `arrayBuffer()` instead of `text()`; added a Save XLSX button.

## Verification

- `npm run typecheck` — clean.
- `npx vitest run` — 189/189 passing, including `zip.test.ts` (round-trip,
  stored/foreign-deflate fixtures, error handling) and `xlsx.test.ts`
  (numFmt mapping both directions, full round-trip fidelity, an
  Excel-convention fixture with shared strings/formulas/builtin formats).
- Independent code review (two passes): first pass found two blocking
  issues — currency-with-zero-decimals misclassifying on import, and the
  demo routing `.xlsx`-named files to the xlsx parser regardless of
  content — both fixed and covered by new tests; a third finding (cached
  formula values for out-of-range empty refs producing spurious `#REF!`)
  was also fixed with a regression test. Second pass: PASS.
- Live E2E in the demo dev server (browser preview): real save→open
  round trip with formulas/dates/currency/styles/colWidths rendered
  pixel-identically; injection guard confirmed (`'=2+2` displayed
  literally, not evaluated); a renamed non-xlsx file correctly fell back
  to CSV; a corrupt-but-PK-prefixed file triggered the alert path and
  left the current document untouched.
- Interop: a file authored independently with Python's `openpyxl` (real
  deflate compression, sharedStrings, styles.xml) imported correctly
  into the demo. A file saved by the demo was opened directly in
  Microsoft Excel and Numbers on this machine (via `open -a`); both
  apps' own AppleScript dictionaries read back correct values, the
  live-recalculated formula result, and the number format with no
  repair-warning dialog blocking access.

## Notes

- Scope: first worksheet only, no merged cells/row heights/borders/rich
  text formatting/images/charts/zip64/encryption — all explicit non-goals
  in the requirement.
- `thousands`/`number` with matching decimal counts share Excel builtin
  numFmt ids, so a rare label swap (`number,0` ↔ `thousands,0`) can occur
  on import; display output is identical either way.
