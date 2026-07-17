# E2E Spec: excel-grid-library

Target: demo app (`npm run dev`) in a Chromium browser pane. Each scenario is independent; reload the page between scenarios unless noted.

## S1 — Render and virtualization

1. Load the demo page.
2. **Expect**: column headers `A B C …`, row headers `1 2 3 …`, select-all corner, formula bar visible; sample data block rendered.
3. Count grid cell elements in the DOM.
4. **Expect**: cell count is on the order of the viewport (well under 3,000), not 1,000,000.
5. Scroll to bottom-right of the grid (row 10000, column CV).
6. **Expect**: headers show row 10000 / column CV area; scrolling stays responsive.

## S2 — Selection

1. Click cell B2. **Expect**: B2 gets the active-cell outline; formula bar reference shows `B2`.
2. Drag from B2 to D5. **Expect**: range B2:D5 highlighted; active cell stays B2.
3. Shift+click F8. **Expect**: selection extends to B2:F8.
4. Press Shift+ArrowRight. **Expect**: selection extends one column.
5. Click row header 3. **Expect**: entire row 3 selected.
6. Click column header C. **Expect**: entire column C selected.
7. Press Ctrl/Cmd+A. **Expect**: whole grid selected.

## S3 — Keyboard navigation

1. Click A1. Press ArrowDown, ArrowRight. **Expect**: active cell A2 then B2.
2. Press Tab twice, Shift+Tab once. **Expect**: active cell moves right twice, left once.
3. Press Enter, Shift+Enter. **Expect**: active cell moves down then back up.
4. Navigate to E10, press Home. **Expect**: active cell A10.
5. Press Ctrl/Cmd+Home. **Expect**: active cell A1.
6. Press PageDown then PageUp. **Expect**: viewport-sized jump down, then back.

## S4 — Editing

1. Double-click C3, type `hello`, press Enter. **Expect**: C3 shows `hello`; active cell C4.
2. Select C3, press F2, append `!`, press Tab. **Expect**: C3 shows `hello!`; active cell D3.
3. Select C3, type `42` directly (type-to-replace), press Enter. **Expect**: C3 shows `42`.
4. Select C3, press F2, type extra text, press Escape. **Expect**: edit cancelled, C3 still `42`.
5. Select C3, press Delete. **Expect**: C3 empty.
6. Select a cell, type into the formula bar, press Enter. **Expect**: cell updates.

## S5 — Formulas and recalculation

1. Enter `1` in A1, `2` in A2, `3` in A3.
2. Enter `=SUM(A1:A3)` in A5. **Expect**: A5 displays `6`; formula bar shows `=SUM(A1:A3)` when A5 selected.
3. Change A2 to `10`. **Expect**: A5 recalculates to `14`.
4. Enter `=IF(A5>10,"big","small")` in B5. **Expect**: `big`.
5. Enter `=1/0` in C1. **Expect**: `#DIV/0!`.
6. Enter `=NOSUCHFN(1)` in C2. **Expect**: `#NAME?`.
7. Enter `=C3` in C3. **Expect**: `#CYCLE!`.
8. Enter `=AVERAGE(A1:A3)` in D1 and `=A1&" pts"` in D2. **Expect**: `4.666…` (or rounded display) and `1 pts`.

## S6 — Copy / paste with reference adjustment

1. Enter `1` in A1, `2` in B1, `=A1+B1` in C1 (**expect** `3`).
2. Select A1:C1, press Ctrl/Cmd+C.
3. Click A3, press Ctrl/Cmd+V. **Expect**: A3=`1`, B3=`2`, C3 shows `3` with formula `=A3+B3`.
4. Change A3 to `5`. **Expect**: C3 recalculates to `7`; C1 remains `3`.
5. Select A1:C1, press Ctrl/Cmd+X, click A5, press Ctrl/Cmd+V. **Expect**: values moved to A5:C5; A1:C1 cleared.

## S7 — Undo / redo

1. Enter `abc` in B2. Press Ctrl/Cmd+Z. **Expect**: B2 empty.
2. Press Ctrl/Cmd+Y (or Shift+Ctrl/Cmd+Z). **Expect**: B2 `abc` again.
3. Paste a multi-cell block, press Ctrl/Cmd+Z. **Expect**: entire paste reverted in one step.

## S8 — Column resize

1. Hover the right edge of column B's header. **Expect**: resize cursor.
2. Drag right ~60px. **Expect**: column B and its cells widen; later columns shift.

## S9 — Fill handle

1. Enter `1` in A1 and `=A1*2` in B1.
2. Select A1:B1. **Expect**: fill handle square at selection bottom-right.
3. Drag the fill handle down to row 4.
4. **Expect**: A2:A4 = `1`; B2 = `=A2*2` → `2`... i.e., each Bn shows double of An with adjusted formula.

## S10 — Imperative API (demo buttons)

1. Click the demo's "Set via API" button (calls `ref.setCell`). **Expect**: target cell updates in the grid.
2. Click the demo's "Read via API" button. **Expect**: the demo surfaces the value read from `ref.getCell`.
