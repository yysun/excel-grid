# E2E: column-filter-popup

Run against the demo app (`npm run dev`, port 5199). The demo preloads
`accounts-6.json` (~1,300 rows), so scenarios run against real columns —
substitute any two columns with a small distinct value set (e.g. G "City"
and H "Province") for A/B below, and any multi-valued text column for the
value names. "Header" means the lettered column header strip. The steps
below describe the canonical small dataset for reference; on the preloaded
demo, verify the same behaviors with the substituted columns.

## Setup (canonical reference data)

1. Open the demo app.
2. Column A rows 1–5: `Apple`, `Banana`, `Apple`, `Cherry`, `` (A5 blank).
3. Column B rows 1–5: `1`, `2`, `1`, `3`, `4`.

## Scenario 1: Toolbar toggle shows/hides filter buttons

1. Select a range spanning columns A and B (e.g. A1:B2).
2. Click the toolbar Filter button.
   - Expect: filter buttons appear on headers A and B only; toolbar Filter
     button renders pressed.
3. Click the toolbar Filter button again.
   - Expect: filter buttons disappear from all headers; pressed state
     clears; all rows visible.

## Scenario 2: Multi-value filter via popup

1. Enable filter buttons on columns A and B (Scenario 1 step 2).
2. Click the header-A filter button.
   - Expect: popup opens listing `Apple`, `Banana`, `Cherry`, `(Blanks)`
     in that order (numbers sort before text; blanks always last) with all
     boxes checked, plus Select all, a search box, OK and Cancel.
3. Uncheck `Apple` and `(Blanks)`, click OK.
   - Expect: rows 1, 3, 5 hidden; rows 2 (`Banana`) and 4 (`Cherry`)
     visible; header-A filter button shows the active highlight.
4. Reopen the header-A popup.
   - Expect: `Banana` and `Cherry` checked; `Apple` and `(Blanks)`
     unchecked.
5. Click Select all, then OK.
   - Expect: all rows visible again; header-A button no longer highlighted.

## Scenario 3: AND across two columns

1. Filter column A to only `Apple` (rows 1, 3 remain).
2. Filter column B to only `1` — popup for B lists `1`, `2`, `3`, `4`.
   - Expect: after OK, visible data rows are exactly 1 and 3 (Apple + 1).
3. Change B3 to `9` (edit the cell).
   - Expect: row 3 hides immediately (re-evaluation on edit).
4. Open header-B popup, Select all, OK.
   - Expect: rows 1 and 3 visible (A filter still active), row 3 shows `9`.

## Scenario 4: Cancel and search

1. Open the header-A popup, uncheck everything, click Cancel.
   - Expect: no visibility change; reopening shows the prior checked set.
2. Open the header-A popup, type `an` in the search box.
   - Expect: list narrows to `Banana` (case-insensitive substring).
3. Clear the search.
   - Expect: full list returns with checkbox states preserved.

## Scenario 5: Context menu integration

1. With filter mode off, right-click cell A2 (`Banana`) and choose
   "Filter by cell value".
   - Expect: header-A gains a highlighted filter button; only rows with
     `Banana` in column A remain visible.
2. Right-click a cell and choose "Clear filter".
   - Expect: all rows visible; header-A filter button remains (not
     highlighted).
