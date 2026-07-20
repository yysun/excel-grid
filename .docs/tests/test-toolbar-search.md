# E2E: toolbar-search

Run against the demo app (`npm run dev`, port 5199). The demo preloads
`accounts-6.json` (~1,328 rows) with headers in row 1 (A=ID, B=Name,
C=Brand, D=Status, E=Phone, F=Website, G=City, H=Province, ...). The search
box sits at the right edge of the toolbar — there is no separate scope
control; the search always scopes to whatever columns are currently
selected in the grid.

> Corrected 2026-07-20: the scope dropdown ("All columns" / "Selected
> columns") described in an earlier version of this spec was removed per
> user feedback ("No need column dropdown, use the grid column selection").
> The scenarios below reflect the corrected, selection-driven design and
> have been re-executed against it (see "Expect" evidence in each step).

## Scenario 1: Typing filters the grid live and highlights matches, scoped to the current selection

1. Open the demo app. With the default selection (cell A1 only), click the
   search box and type `Vernon`.
   - Expect: on every keystroke (no separate "apply" step) the grid narrows
     to only rows whose column A contains "Vernon" — since the selection is
     a single cell in column A, scope is column A only. (Verified: with
     this dataset, column A holds numeric IDs, so this narrows to zero
     rows — the view scrolls to the blank rows below the data.)
2. Clear the search box. Select every column (e.g. select-all) and type
   `Vernon` again.
   - Expect: rows whose column A through the last column contain "Vernon"
     anywhere are shown; every cell containing "Vernon" renders the match
     highlighted (yellow background) within the cell text. (Verified: 7
     rows shown — row-header numbers 7, 275, 276, 962, 1014, 1108, 1296 —
     with matches highlighted across multiple columns per row, e.g. both
     column B and column G on row 1014.)

## Scenario 2: Clearing the search restores the grid

1. With a query active (Scenario 1), click the × clear button inside the
   search box (or delete all the typed text).
   - Expect: all 1,328 rows reappear in row order; no cell shows a
     highlight anywhere. (Verified.)

## Scenario 3: Selecting a column in the grid narrows search to it, live

1. Click the column G ("City") header to select the whole column.
2. Type `Vernon` in the search box.
   - Expect: only rows whose column G contains "Vernon" are shown; only
     column G cells are highlighted — matches in other columns (e.g. a
     company name containing "Vernon" in column B) are not highlighted and
     do not keep their row visible unless column G also matches. (Verified:
     narrowed from Scenario 1's 7 rows to 5 — rows 7, 275, 276, 962, 1014 —
     and row 1014's column B "RE/MAX Vernon..." text was no longer
     highlighted, only its column G "Vernon".)
3. Without touching the search box, click the column A header to select
   column A instead.
   - Expect: the visible rows update immediately to reflect matches in
     column A instead of column G — no retyping or extra toggle needed,
     since the search always reads the grid's live selection. (Verified:
     scope re-pinned to column A instantly, and since column A is numeric
     IDs, all rows dropped out of the filtered view with no further
     interaction.)

## Scenario 4: Search composes with an active column filter

(Covered directly and deterministically by
`src/state/GridStore.search.test.ts` — "interaction with column filters" —
since reproducing a precise filter + search combination via manual
clicking is error-prone; the store-level behavior these UI scenarios
depend on is unit-tested: a row hidden by a column filter stays hidden
even when it matches the search query, and a row must pass both to show.)

## Scenario 5: Editing a cell while a query is active re-evaluates its row

1. Select cell B2 ("1NE Collective Realty") — this also sets search scope
   to column B. Type `1NE Collective` into the search box.
   - Expect: only row 2 is shown. (Verified.)
2. With row 2 still the only visible row, edit cell B2's text so it no
   longer contains "1NE Collective" (e.g. type over it and commit with
   Enter).
   - Expect: row 2 disappears from the filtered view immediately. (Verified:
     editing B2 to "Totally Different Name" left zero rows visible, with
     the onChange log confirming the edit committed.)
3. Undo the edit (Ctrl+Z).
   - Expect: row 2 reappears with its original text. (Verified.)
