# E2E: Merged cells, borders, format painter, font family (story `cell-format-suite`)

Run against the demo app (`npm run dev`, browser preview). Grid defaults:
1000 rows × 26 cols.

## 1. Merge cells

1. Put `hello` in A1, `world` in B1, `x` in A2. Select A1:B2, click the
   Toolbar's "Merge cells" button.
2. Expect: A1:B2 renders as one spanning block showing `hello`; B1/A2/B2
   render nothing and are not independently clickable.
3. Press Ctrl/Cmd+Z → the merge undoes in one step; B1 is empty again (its
   content was cleared by the merge, not restored — Excel semantics), A2
   still shows `x`. Redo restores the merge.
4. Click anywhere inside the merged block → the whole block highlights as
   selected/active; the name box shows A1 (the anchor); the formula bar
   shows `hello`.
5. With the merge selected, press ArrowRight → active cell moves to C1
   (one step past the merge's right edge), not into B1/B2.
6. From C1, press ArrowLeft → active cell lands back on the merged block
   (shown as A1, selecting the whole block again).
7. Double-click inside the merged block (anywhere in its area) → the
   in-cell editor opens over the anchor with `hello` as its content.
8. Right-click inside the merged block → context menu shows "Unmerge
   cells". Click it → A1 keeps `hello`, B1/A2/B2 stay blank and are
   independently selectable again.
9. Select A1:B2 again, merge it. Then select B2:C3 (overlapping) and merge
   that too → the first merge is replaced; only one merge (B2:C3) remains.
10. Merge D1:D3 (a 3-row, 1-col merge). Select row header 2 (a row inside
    the merge but not its anchor) and right-click → "Insert 1 row above" /
    "Delete row" (not widened to a 3-row action) — confirms structural
    row commands use the literal selected row, not the merge's full span.
11. With D1:D3 merged, select the WHOLE row 2 via its header and click a
    Toolbar style button (e.g. Bold) → the merge (D1:D3) is bolded, since
    Toolbar style actions expand to the touched merge.
12. Insert 2 rows above row 1 (with D1:D3 merged) → the merge shifts down
    to D3:D5 intact.
13. Delete row 5 only (the merge's far edge, D3:D5) → the merge shrinks to
    D3:D4 (not dropped, since its anchor D3 survives).
14. Delete row 3 (the merge's anchor row) → the merge is dropped entirely
    (D4 renders as a plain independent cell again).
15. Save the sheet as .xlsx (demo's Save XLSX) with an active merge, reload
    it (Open…) → the merge is intact after the round-trip.

## 2. Borders

1. Select A1:C3. Open the Toolbar's Borders dropdown, pick a red color and
   "thick" width, click "All borders" → every cell in A1:C3 shows a thick
   red border on all four sides.
2. Undo → borders clear in one step.
3. Select A1:C3 again, pick "thin"/black, click "Outside borders" → only
   the outer edge of the range shows a border (top row's top edge, bottom
   row's bottom edge, left column's left edge, right column's right edge);
   interior cell B2 shows no border.
4. Click "Top border" on a fresh range D1:F1 → only the top edge renders
   (all three cells' top side); no bottom/left/right borders appear.
5. Apply a border, then click "No border" on the same range → all border
   sides clear; other formatting (e.g. bold from an earlier step) is
   unaffected.
6. Save as .xlsx and reload → the border sides/color/thickness survive.

## 3. Format painter

1. Bold + italic + red-text a cell (e.g. A1). Select A1, click the Toolbar's
   "Format Painter" button → the button shows a pressed/active state; the
   grid body cursor becomes a crosshair.
2. Click a different, unformatted cell (e.g. C5) → C5 immediately takes on
   A1's bold/italic/red style; the Format Painter button returns to its
   normal (unarmed) state.
3. Arm the painter again from a styled cell, then drag-select a multi-cell
   range (e.g. E1:F3) as the destination → every cell in E1:F3 takes the
   source's style (not tiled — all cells get the same single style).
4. Arm the painter, then press Escape before clicking a destination → the
   painter disarms with no style changes anywhere.
5. Arm the painter from a cell with NO style, click a previously-bold cell
   → the destination's bold (and any other formatting) is cleared,
   confirming format painter replaces rather than merges styles.
6. Undo after a successful paint → the destination's prior style (or lack
   of one) is restored in one step.

## 4. Font family

1. Select a cell, open the Toolbar's font-family dropdown → it lists
   Default, Arial, Times New Roman, Georgia, Courier New, Verdana,
   Trebuchet MS, Comic Sans MS, with a checkmark on the active cell's
   current choice (Default when unset).
2. Pick "Georgia" → the cell's text visibly renders in Georgia; the
   dropdown button's label updates to "Georgia".
3. Select a range spanning multiple cells, pick "Courier New" → every cell
   in the range renders in Courier New as one undo step.
4. Undo → the font reverts for the whole range in one step.
5. Save as .xlsx and reload → the chosen font family survives per cell.
