# E2E: grid-persistence

Run against the demo dev server (`npm run dev`, demo at the vite URL).
Inspect localStorage via in-browser JS. Start each scenario from a fresh
state: `localStorage.clear()` then reload, unless the scenario says
otherwise.

## Scenario 1 — Blank grid on first load

1. Clear localStorage and reload the demo.
2. Expect: an empty grid (no account rows), header shows file name
   `untitled.csv`, and buttons `New`, `Open CSV…`, `Save CSV` are visible.
3. Expect: no `excel-grid-demo:*` keys exist yet (or only after first edit).

## Scenario 2 — Autosave on data, format, and width edits

1. Type `hello` into A1 and `=1+2` into B1 (commit each).
2. Within ~1 s, expect `localStorage["excel-grid-demo:file:untitled.csv"]`
   to contain JSON whose `cells.A1 === "hello"` and `cells.B1 === "=1+2"`.
3. Select A1, click Bold and apply Currency format from the toolbar.
4. Expect the stored JSON's `styles.A1` to include `bold: true` and
   `numFmt: "currency"` (no manual save clicked).
5. Resize column A wider; expect the stored JSON's `colWidths["0"]` to be
   the new width.

## Scenario 3 — Reload restores data + format

1. Continue from Scenario 2. Reload the page.
2. Expect: A1 shows `hello` in bold; B1 shows `3` (formula recomputed;
   formula bar shows `=1+2` when selected); column A keeps its width;
   file name still `untitled.csv`.

## Scenario 4 — Open CSV

1. Prepare a small CSV file containing quoted fields, e.g.
   `name,note\n"Smith, John","says ""hi""\nsecond line","=SUM(1,2)"`
   (the formula-looking field must be quoted — it contains a comma).
2. Click `Open CSV…` and pick the file.
3. Expect: grid replaced by the CSV contents — A1 `name`, A2 `Smith, John`,
   B2 contains the embedded quote + newline, and the `=SUM(1,2)` field is
   NOT evaluated: it is stored apostrophe-escaped and displays literally
   as `'=SUM(1,2)` (leading apostrophe visible by design).
4. Expect: header file name becomes the picked file's name, and a
   `excel-grid-demo:file:<that name>` key holds the state; an edit now
   persists under that key.

## Scenario 5 — Save CSV

1. With a few cells filled (including a formula and a value containing a
   comma), click `Save CSV`.
2. Expect: a download named after the current file name is produced; no
   console errors. Exported cells are the displayed text (formulas as
   computed results, number formats applied). (CSV quoting correctness
   is covered by unit tests on `toCSV`.)

## Scenario 6 — New/Clear

1. With saved state present, click `New`.
2. Expect a confirmation prompt; cancel → nothing changes.
3. Click `New` again and confirm.
4. Expect: grid empties, file name resets to `untitled.csv`, and the
   `excel-grid-demo:file:untitled.csv` entry is removed; reloading still
   shows a blank grid.
