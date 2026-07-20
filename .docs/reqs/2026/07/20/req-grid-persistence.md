# REQ: grid-persistence

localStorage autosave of grid state (data + format) keyed by file name, plus
demo-app file actions: Open CSV, Save CSV, New/Clear grid.

## Problem

The demo app always boots from the bundled `accounts-6.json` sample; every
edit (cell content, formatting, column widths) is lost on reload. There is no
way to open a user's own CSV file, save the grid back out as CSV, or start a
fresh sheet. Users cannot treat the demo as a lightweight spreadsheet editor
because work does not persist.

## Requirement

1. **Automatic persistence (demo app)**: after each edit — cell content,
   cell formatting/style, and column-width changes — the demo app saves the
   full grid state to `localStorage` under a key derived from the current
   file name. Saves are automatic (no Save button needed for persistence)
   and may be debounced briefly to coalesce bursts.
2. **State fidelity**: the persisted state includes cell raw text (formulas
   preserved as `=`-text) and per-cell styles (bold/italic/colors/alignment/
   wrap/number format/decimals) and column widths, so a reload restores the
   sheet visually and functionally as it was.
3. **Load on start (demo app)**: on startup the demo loads the persisted
   state for the current file name from `localStorage`. If no persisted
   state exists, it shows a blank grid (no more bundled accounts data).
4. **File name tracking (demo app)**: the demo tracks a current file name
   (default e.g. `untitled.csv`), displays it, and uses it as the
   localStorage key suffix. Opening a CSV switches the current file name to
   the opened file's name; New/Clear resets to the default name.
5. **Open CSV**: a toolbar/header button lets the user pick a `.csv` file
   from disk via the browser File API; its parsed contents replace the grid
   (and become the new persisted state under that file's name).
6. **Save CSV**: a button downloads the current grid's used range as a
   `.csv` file named after the current file name. Exported cells contain
   the displayed text (Excel-like CSV: formulas export their computed
   result, number formats such as currency/date are applied, booleans as
   TRUE/FALSE), with proper CSV quoting for commas/quotes/newlines.
7. **New/Clear grid**: a button resets to an empty grid under the default
   file name and clears that file's persisted state, after a confirm prompt
   so stored work is not destroyed by a stray click.
8. **Library support**: `excel-grid` exposes whatever minimal
   public API the demo needs to do the above (full-state snapshot including
   styles and column widths, a way to initialize from such a snapshot, and
   a change signal that also fires for style/format/width edits).

## Acceptance Criteria

- [x] Editing a cell value, applying a style (e.g. bold or currency format),
      and resizing a column each cause the demo to write updated state to
      `localStorage` (observable via devtools/JS) without any manual save.
- [x] Reloading the demo page restores previously edited data, formats, and
      column widths exactly (formulas still compute; styles still render).
- [x] With `localStorage` empty, the demo starts with a completely blank
      grid and the default file name; the bundled accounts data no longer
      auto-loads.
- [x] "Open CSV" loads a picked CSV file into the grid: parsed rows/columns
      appear, the shown file name becomes the picked file's name, and
      subsequent edits persist under that name.
- [x] "Save CSV" downloads a file named after the current file name whose
      contents are valid CSV of the used range with displayed cell text
      (formats applied) and correct quoting (comma, quote, newline cases).
- [x] "New/Clear" (after confirm) empties the grid, resets the file name to
      the default, and removes the old persisted entry for the default name
      so a reload shows the blank grid.
- [x] Library public API includes a full-state snapshot (cells + styles +
      column widths), snapshot-based initialization, and a state-change
      notification covering style-only and width-only edits; `npm run
      typecheck`, `npm run build`, and `npm test` pass.

## Constraints

- Persistence, file naming, and buttons are demo-app concerns; the library
  gains only generic snapshot/notification APIs (no localStorage or file I/O
  inside the library).
- New library APIs must be additive — existing props (`initialCells`,
  `onChange`) and handle methods keep working unchanged.
- CSV parsing must handle quoted fields with embedded commas, quotes, and
  newlines (RFC-4180 style, as Excel/Sheets emit).
- Cell text that starts with `=` when importing CSV must not execute as a
  formula surprise: imported values are literal data (escape or quote them
  the way the demo already does for JSON imports).
- Autosave must not noticeably lag editing on sheets of the current demo
  scale (~1,500 rows); debouncing is acceptable, losing edits on normal
  navigation/reload is not (flush or short debounce).

## Non-Goals

- No multi-sheet/workbook model, no file-picker "recent files" UI, and no
  listing/switching among multiple saved localStorage entries.
- No XLSX import/export; CSV only.
- No preservation of formulas or styles through CSV round-trips (CSV is
  values-only by design; full fidelity lives in localStorage).
- No File System Access API (`showOpenFilePicker`) requirement; plain
  `<input type="file">` + Blob download is sufficient.
- No library-side persistence layer, storage adapters, or feature flags.
- Filters, hidden rows/cols, frozen panes, and search state are view state
  and are not required to persist.
