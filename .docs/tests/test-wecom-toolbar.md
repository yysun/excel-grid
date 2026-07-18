# E2E Spec: wecom-toolbar

Target: demo app (launch config `demo`, port 5199) in the browser pane.
Reload between scenarios unless noted. "Toolbar" = the bar above the formula
bar inside the grid.

## T1 — Toolbar renders (WeCom minimal style)

1. Load the demo page.
2. **Expect**: a flat toolbar above the formula bar with, left to right:
   undo, redo | clear format | `%`, `,`, decimal+ / decimal- | font size
   dropdown | B, I, U, S | text color, fill color | align left/center/right |
   Σ. Buttons show Chinese tooltips on hover (`title`).
3. **Expect**: undo and redo are disabled (dimmed) on a fresh load.

## T2 — Bold / italic / underline / strikethrough toggle

1. Drag-select B1:D1.
2. Click **B**. **Expect**: B1:D1 render bold; the B button shows a pressed
   (blue) state while a bold cell is active.
3. Click **B** again. **Expect**: bold removed from the whole range.
4. Apply I, U, S to B2 similarly. **Expect**: italic, underline,
   strikethrough render (U+S combine on one cell).

## T3 — Colors

1. Select A2:A4, open text color, pick red. **Expect**: text turns red.
2. Open fill color, pick yellow. **Expect**: cell backgrounds turn yellow,
   including any empty cell in the range.
3. Reopen each palette, choose Automatic. **Expect**: color/fill reset.

## T4 — Font size and alignment

1. Select A1, choose font size 18. **Expect**: A1 text is larger; dropdown
   shows 18 while A1 active.
2. Select G2:G5 (numeric Agents column), click align-center.
   **Expect**: numbers center instead of default right alignment.
3. Click align-left, then align-right. **Expect**: alignment follows;
   the active alignment button shows pressed state.

## T5 — Number formats

1. Type `0.5` into an empty cell, select it, click `%`.
   **Expect**: displays `50%`; formula bar still shows raw `0.5`.
2. Click decimal+ twice. **Expect**: `50.00%`.
3. Type `1234567` into another cell, click `,`. **Expect**: `1,234,567`.
4. Click decimal- on a `,`-formatted cell with decimals. **Expect**: one
   fewer decimal, floor 0.
5. Apply `%` to a text cell. **Expect**: text display unchanged.

## T6 — Clear format

1. Give a cell bold + red + yellow fill + percent format.
2. Click 清除格式. **Expect**: all styling and number format gone in one
   click.
3. Press Ctrl/Cmd+Z. **Expect**: all styling returns in one undo step.

## T7 — Undo / redo integration

1. Bold B1, type `x` into B3, fill-color B5.
2. Click toolbar undo three times. **Expect**: fill removed, then `x`
   removed, then bold removed — interleaved order respected.
3. Click redo three times. **Expect**: all three return; buttons
   enable/disable correctly at stack ends.

## T8 — Quick sum (Σ)

1. Enter `1`, `2`, `3` in H2:H4 (or reuse numeric data), select H2:H4.
2. Click Σ. **Expect**: H5 contains `=SUM(H2:H4)` and displays `6`.
3. Select a two-column numeric range and click Σ. **Expect**: a SUM formula
   below each column.
4. Ctrl/Cmd+Z. **Expect**: inserted formulas removed in one step.

## T9 — Virtualization persistence & toolbar prop

1. Style a cell (bold + fill), scroll far away, scroll back.
   **Expect**: style still rendered.
2. (Code-level check) Set `toolbar={false}` on `ExcelGrid` in a scratch
   render or verify prop plumbing in code review. **Expect**: toolbar hidden.
