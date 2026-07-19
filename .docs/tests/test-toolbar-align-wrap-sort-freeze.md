# E2E: Toolbar — vertical alignment, wrap, sort, filter, freeze panes

Run against the demo app (`npm run dev`, default Vite port). Grid defaults:
1000 rows × 26 cols, row height 24.

## Scenario 1 — Vertical alignment

1. Type `Top` into A1, press Enter. Select A1.
2. Click the Align top toolbar button.
   - Expect: A1's text sits at the top edge of the cell; the button shows a
     pressed state while A1 is active.
3. Click Align bottom.
   - Expect: text moves to the bottom edge; bottom button pressed, top not.
4. Click Align bottom again.
   - Expect: alignment resets to default (vertical center); no button pressed.
5. Press Ctrl/Cmd+Z twice.
   - Expect: alignment steps back through bottom → top states (undoable).

## Scenario 2 — Text wrapping

1. Type `wrap wrap wrap wrap wrap` into B2 (long enough to overflow the
   column). Select B2.
2. Click the Wrap text toolbar button.
   - Expect: B2 renders the text on multiple lines within the row height
     (clipped if too tall); the button is pressed while B2 is active.
3. Click Wrap text again.
   - Expect: text returns to a single clipped line; button unpressed.
4. Click Wrap text once more to re-enable wrap, then click Clear formatting.
   - Expect: wrap is removed (single line again, button unpressed).

Note: at the default 24px row height a two-line wrap is clipped; verify via
DOM reads (line boxes / scrollHeight) or after making the row taller.

## Scenario 3 — Sorting (column-header buttons)

1. Verify the toolbar contains no sort buttons.
2. Enter in A1:A4 the values `3`, `1`, `2`, `banana`; in B1:B4 enter
   `c`, `a`, `b`, `d`.
3. Hover column header A.
   - Expect: a small sort button appears in the header (hidden when not
     hovered); hovering it does not select the column.
4. Click the header-A sort button.
   - Expect: the whole used range sorts by column A ascending — numbers
     first (1, 2, 3), text after (banana); B values move with their rows.
     The column is not selected by the click.
5. Click the header-A sort button again.
   - Expect: descending order (direction toggles on repeat click).
6. Click the header-B sort button.
   - Expect: used range sorts by column B ascending (a fresh column starts
     at ascending).
7. Press Ctrl/Cmd+Z.
   - Expect: the last sort is undone.

## Scenario 4 — Filtering

1. Enter in C1:C4: `x`, `y`, `x`, `y`. Select C1 (value `x`).
2. Click the Filter toolbar button.
   - Expect: rows whose C value ≠ `x` (rows 2 and 4) are hidden; the filter
     button shows a pressed state.
3. Click Filter again.
   - Expect: hidden rows reappear; button unpressed.

## Scenario 5 — Freeze panes

1. Select cell B3 (or range ending at row 3 / col B). Click the Freeze panes toolbar button.
   - Expect: a popover opens with freeze-rows, freeze-cols, and unfreeze
     items; unfreeze is disabled when nothing is frozen.
2. Click "Freeze up to row 3".
   - Expect: rows 1–3 stay pinned while scrolling vertically; freeze button
     shows a pressed state.
3. Open the popover again, click "Freeze up to column B".
   - Expect: columns A–B stay pinned while scrolling horizontally.
4. Open the popover, click Unfreeze.
   - Expect: no panes frozen; freeze button unpressed; scrolling moves all
     rows/columns.

## Scenario 6 — Regression spot-checks

1. Bold + fill color still apply from the toolbar (no layout breakage from
   new buttons).
2. A wrapped cell containing a number (e.g. `12345678901234`) still
   right-aligns.
3. Toolbar popovers (font size, colors, freeze) close on outside click.
