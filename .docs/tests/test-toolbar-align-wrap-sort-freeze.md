# E2E: Toolbar — vertical alignment, wrap, sort, filter, freeze panes

Run against the demo app (`npm run dev`, default Vite port). Grid defaults:
1000 rows × 26 cols, row height 24.

## Scenario 1 — Vertical alignment

1. Type `Top` into A1, press Enter. Select A1.
2. Click the 顶端对齐 (top-align) toolbar button.
   - Expect: A1's text sits at the top edge of the cell; the button shows a
     pressed state while A1 is active.
3. Click 底端对齐 (bottom-align).
   - Expect: text moves to the bottom edge; bottom button pressed, top not.
4. Click 底端对齐 again.
   - Expect: alignment resets to default (vertical center); no button pressed.
5. Press Ctrl/Cmd+Z twice.
   - Expect: alignment steps back through bottom → top states (undoable).

## Scenario 2 — Text wrapping

1. Type `wrap wrap wrap wrap wrap` into B2 (long enough to overflow the
   column). Select B2.
2. Click the 自动换行 (wrap) toolbar button.
   - Expect: B2 renders the text on multiple lines within the row height
     (clipped if too tall); the button is pressed while B2 is active.
3. Click 自动换行 again.
   - Expect: text returns to a single clipped line; button unpressed.
4. Click 自动换行 once more to re-enable wrap, then click 清除格式
   (clear format).
   - Expect: wrap is removed (single line again, button unpressed).

Note: at the default 24px row height a two-line wrap is clipped; verify via
DOM reads (line boxes / scrollHeight) or after making the row taller.

## Scenario 3 — Sorting

1. Enter in A1:A4 the values `3`, `1`, `2`, `banana`; in B1:B4 enter
   `c`, `a`, `b`, `d`.
2. Select range A1:B4. Click 升序 (sort ascending).
   - Expect: rows reorder by column A ascending — numbers first (1, 2, 3),
     text after (banana); B column moves with its rows (a, b, c, d order
     follows A).
3. Click 降序 (sort descending) with the same selection.
   - Expect: reverse order, blanks (if any) last.
4. Select only cell A2 (single cell). Click 升序.
   - Expect: the whole used range sorts by column A (same as header context
     menu behavior).
5. Press Ctrl/Cmd+Z.
   - Expect: sort is undone (values return).
6. Select the single-row range A1:B1.
   - Expect: both sort buttons are disabled (consistent with the context
     menu, which disables sort for single-row ranges).

## Scenario 4 — Filtering

1. Enter in C1:C4: `x`, `y`, `x`, `y`. Select C1 (value `x`).
2. Click the 筛选 (filter) toolbar button.
   - Expect: rows whose C value ≠ `x` (rows 2 and 4) are hidden; the filter
     button shows a pressed state.
3. Click 筛选 again.
   - Expect: hidden rows reappear; button unpressed.

## Scenario 5 — Freeze panes

1. Select cell B3 (or range ending at row 3 / col B). Click the 冻结
   (freeze) toolbar button.
   - Expect: a popover opens with freeze-rows, freeze-cols, and unfreeze
     items; unfreeze is disabled when nothing is frozen.
2. Click "冻结至第 3 行".
   - Expect: rows 1–3 stay pinned while scrolling vertically; freeze button
     shows a pressed state.
3. Open the popover again, click "冻结至第 B 列".
   - Expect: columns A–B stay pinned while scrolling horizontally.
4. Open the popover, click 取消冻结.
   - Expect: no panes frozen; freeze button unpressed; scrolling moves all
     rows/columns.

## Scenario 6 — Regression spot-checks

1. Bold + fill color still apply from the toolbar (no layout breakage from
   new buttons).
2. A wrapped cell containing a number (e.g. `12345678901234`) still
   right-aligns.
3. Toolbar popovers (font size, colors, freeze) close on outside click.
