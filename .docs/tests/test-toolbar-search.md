# E2E: toolbar-search

Run against the demo app (`npm run dev`, port 5199). The demo preloads
`accounts-6.json` (~1,328 rows) with headers in row 1 (A=ID, B=Name,
C=Brand, D=Status, E=Phone, F=Website, G=City, H=Province, ...). The search
box and scope selector sit at the right edge of the toolbar.

## Scenario 1: Typing filters the grid live and highlights matches

1. Open the demo app. Click the search box and type `Vernon`.
   - Expect: on every keystroke (no separate "apply" step) the grid narrows
     to only rows containing "Vernon" somewhere in their data (verified:
     rows with row-header numbers 7, 275, 276, 962, 1014, 1108, 1296 were
     the only ones shown out of 1,328).
   - Expect: every cell containing "Vernon" (column G "City", and other
     columns where it appears) renders the match highlighted (yellow
     background) within the cell text.

## Scenario 2: Clearing the search restores the grid

1. With a query active (Scenario 1), click the × clear button inside the
   search box (or delete all the typed text).
   - Expect: all 1,328 rows reappear in row order; no cell shows a
     highlight anywhere.

## Scenario 3: "Selected columns" scope narrows matching to the selection

1. Click the column G header to select the whole "City" column.
2. Change the scope dropdown from "All columns" to "Selected columns".
3. Type `Vernon` in the search box.
   - Expect: only rows whose column G contains "Vernon" are shown (verified:
     rows 7, 275, 276, 962, 1014 — narrower than Scenario 1's 7-row result,
     which also included a match outside column G).
   - Expect: only the column G cells are highlighted; other columns in the
     same row (e.g. column B text that happens to contain "Vernon") are not
     highlighted, since they're out of scope.

## Scenario 4: Scope stays live as the selection changes

1. With scope set to "Selected columns" and no query yet, select column A
   (click its header).
   - Expect: the effective search scope is now column A only (verified via
     the store's live-tracking `useEffect`: no re-typing/re-toggling
     needed — selecting a different column while scope is "Selected
     columns" immediately re-pins the scope to the new selection).
2. Switch the scope dropdown to "All columns", then back to "Selected
   columns" is not required between selections — simply changing the grid
   selection while already in "Selected columns" mode is sufficient.

## Scenario 5: Search composes with an active column filter

(Covered directly and deterministically by
`src/state/GridStore.search.test.ts` — "interaction with column filters" —
since reproducing a precise filter + search combination via manual
clicking is error-prone; the store-level behavior these UI scenarios
depend on is unit-tested: a row hidden by a column filter stays hidden
even when it matches the search query, and a row must pass both to show.)

## Scenario 6: Editing a cell while a query is active re-evaluates its row

1. Select cell B2 ("1NE Collective Realty"). Type `1NE Collective` into the
   search box.
   - Expect: only row 2 is shown.
2. With row 2 still the only visible row, edit cell B2's text so it no
   longer contains "1NE Collective" (e.g. type over it and commit with
   Enter).
   - Expect: row 2 disappears from the filtered view immediately (verified:
     editing B2 to "Totally Different Name" while the query "1NE
     Collective" was active left zero rows visible, with the onChange log
     confirming the edit committed).
3. Undo the edit (Ctrl+Z).
   - Expect: row 2 reappears with its original text once the query is
     cleared or edited to match again.
