# E2E: open-save-xlsx

Run against the demo dev server (`npm run dev`, demo at the vite URL).
Start each scenario from a fresh state: `localStorage.clear()` then reload,
unless the scenario says otherwise. Saving downloads a file; use the
browser's download location (or drive `snapshotToXlsx` via in-page JS and
write the bytes to disk) to get the artifact for re-opening.

## Scenario 1 — Save XLSX produces a valid workbook

1. Enter data: A1 `hello` (apply Bold + red text + yellow background),
   B1 `1234.5` with Currency format, C1 `=SUM(B1:B1)*2`, A2 `2024-01-05`
   (grid auto-applies date format), B2 `TRUE`, C2 `=1/0` (shows `#DIV/0!`).
   Widen column A noticeably.
2. Click `Save XLSX`.
3. Expect: a download named after the current file with `.xlsx` extension;
   no console errors. The file starts with `PK\x03\x04` magic bytes.

## Scenario 2 — Re-open the saved file: full fidelity

1. Click `Open…` and pick the file saved in Scenario 1.
2. Expect: A1 shows `hello` bold/red on yellow; B1 shows the currency
   display (e.g. `$1,234.50`); C1 shows `2469` and the formula bar shows
   `=SUM(B1:B1)*2` when selected; A2 shows the date `1/5/2024`; B2 shows
   `TRUE`; C2 shows `#DIV/0!` with its formula intact; column A retains
   its width (±1 px).
3. Expect: header file name becomes the opened file's name and autosave
   persists under `excel-grid-demo:file:<name>`.

## Scenario 3 — Open an Excel-authored workbook

1. Obtain a small workbook authored by Excel/Numbers (or a fixture built
   with Excel conventions: sharedStrings, shared formulas, builtin date/
   percent/currency formats).
2. Click `Open…` and pick it.
3. Expect: string cells import (shared strings resolved), formulas import
   as formulas (shared-formula followers expanded with adjusted refs),
   date/percent/currency cells display with the matching grid formats.
   Unsupported features (theme colors, borders) degrade silently — no
   errors, no import failure.

## Scenario 4 — Injection guard

1. Open a workbook containing a plain string cell whose text starts with
   `=` (a string literal, not a formula).
2. Expect: the cell displays the text literally with a leading apostrophe
   (`'=…`) and is NOT evaluated as a formula.

## Scenario 5 — Corrupt file handling

1. Rename a `.txt`/`.csv` file to `.xlsx` and try `Open…` on it, or pick a
   truncated `.xlsx`.
2. Expect: a `.csv`-renamed file falls back to the CSV path by content
   sniffing (no PK magic); a truly corrupt zip shows an alert and the
   current document stays loaded and editable.

## Scenario 6 — Desktop interop (manual)

1. `open <saved>.xlsx` in Numbers or Excel on this machine.
2. Expect: the workbook opens without repair warnings; values, formats
   (currency/date), styles (bold/colors), formulas, and the widened
   column are visible.
