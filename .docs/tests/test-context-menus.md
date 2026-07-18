# E2E: Context menus (story `context-menus`)

Run against the demo app (`npm run dev`, browser preview). Grid defaults:
1000 rows × 26 cols. Seed for scenarios needing data: put `10` in A1, `2` in
A2, `=A1+A2` in A3, `banana` in B1, `apple` in B2, `Cherry` in B3.

## 1. Menu opening and closing

1. Right-click cell D4 → a custom menu opens at the cursor; the native
   browser menu does not appear; D4 becomes the active cell.
2. Press Escape → menu closes.
3. Right-click row header 5 → row 5 becomes fully selected; the row menu
   shows Cut/Copy/Paste, Insert 1 row above/below, Delete row, Move row
   up/down, Hide row, Unhide rows, Freeze up to row 5, Unfreeze rows.
4. Click on an empty cell outside the menu → menu closes without acting.
5. Select A1:A3, right-click A2 (inside selection) → selection is preserved.
6. Right-click column header C → column C selected; column menu additionally
   shows Sort sheet A→Z / Z→A.
7. Right-click near the bottom-right of the viewport → the menu is fully
   visible (repositioned inside the viewport).

## 2. Insert and delete rows with formula rewrite

1. With seed data, right-click row header 2 → "Insert 1 row above".
2. Expect: A2 empty, A3 is `2`, A4 shows `12` and its formula is `=A1+A3`.
3. Right-click row header 2 → "Delete row". Expect the sheet back to the
   seed layout: A3 shows `12`, formula `=A1+A2`.
4. Right-click row header 1 → "Delete row". Expect A2's formula to show
   `#REF!` (it referenced deleted A1).
5. Press Ctrl/Cmd+Z → deleted row 1 returns, A3 shows `12` again (single
   undo step).

## 3. Insert and delete columns

1. Right-click column header B → "Insert 1 column left". Expect banana/
   apple/Cherry now in column C; B empty.
2. Right-click column header C → "Delete column". Expect the fruit column
   gone entirely; undo restores it.

## 4. Move rows and columns

1. Select rows 1–2 (drag on row headers), right-click → "Move rows down".
   Expect old row 3 content now at row 1, and rows 2–3 holding the old rows
   1–2; the formula still computes 12 (refs followed the move).
2. Undo → original order restored.
3. Right-click column header B → "Move column left". Expect fruits in
   column A, numbers/formula in column B, formula still computing.
4. Undo.

## 5. Hide and unhide

1. Select rows 2–3, right-click → "Hide rows". Expect row headers jump
   1, 4, 5…; the hidden rows' content is not visible.
2. With A1 active, press ArrowDown → active cell is A4 (skips hidden rows).
3. Select rows 1–4, right-click → "Unhide rows" → rows 2–3 reappear.
4. Repeat hide/unhide for column B via the column header menu, including
   ArrowRight from A1 landing on C1 while B is hidden.

## 6. Freeze and unfreeze

1. Right-click row header 2 → "Freeze up to row 2". Scroll the body down
   ~20 rows → rows 1–2 stay pinned under the column headers with their row
   numbers; body rows scroll beneath them.
2. Click a pinned cell (e.g. B1) → it becomes the active cell.
3. Right-click any row header → "Unfreeze rows" → pinning gone.
4. Freeze up to column B via the column menu, scroll right, verify columns
   A–B stay pinned; unfreeze.

## 7. Sort

1. Select B1:B3, right-click → "Sort range A→Z". Expect apple, banana,
   Cherry (case-insensitive) in B1:B3, A1:A3 untouched.
2. Right-click column header B → "Sort sheet Z→A". Expect used-range rows
   reordered so column B reads Cherry, banana, apple and column A values
   moved with their rows.
3. Undo twice → original layout restored.

## 8. Filter

1. Put `x` in C1 and C3 (C2 empty). Right-click C1 → "Filter by cell
   value". Expect row 2 hidden (C2 ≠ "x"); rows 1 and 3 visible.
2. Right-click any cell → "Clear filter" → row 2 visible again.
3. With no filter active, the cell menu shows "Clear filter" disabled.

## 9. Menu clipboard round-trip

1. Select A1:A3, right-click → Copy. Right-click D1 → Paste. Expect D1:D3
   = 10, 2, 12 with the formula relocated (`=D1+D2`).
2. Select B1:B3, right-click → Cut. Right-click E1 → Paste. Expect fruits
   in E1:E3 and B1:B3 now empty.
