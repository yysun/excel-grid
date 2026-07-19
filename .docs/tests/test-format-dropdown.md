# E2E: format-dropdown

Manual/browser scenarios for the toolbar "More formats" (123) dropdown.
Run against the demo app (`npm run dev` / launch config `demo`).

## 1. Menu contents

1. Click the "123 ▾" toolbar button (tooltip "More formats").
2. Expect a dropdown with rows, in order:
   - Automatic (no example)
   - Number — example `1,000.12`
   - Percent — example `10.12%`
   - Scientific — example `1.01E+3`
   - Currency — example `$1,000.12`
3. On a fresh unformatted cell, the check mark is on Automatic.

## 2. Applying formats

1. Type `1234.5` into an empty cell, press Enter, reselect the cell.
2. Choose Number → cell shows `1,234.50`; menu closes.
3. Reopen menu → check mark on Number.
4. Choose Currency → `$1,234.50`.
5. Choose Scientific → `1.23E+3`.
6. Choose Percent → `123450%`.
7. Choose Automatic → `1234.5`; reopened menu marks Automatic.

## 3. Negative currency

1. Type `-1234.5`, apply Currency.
2. Cell shows `-$1,234.50` (sign before the `$`).

## 4. Sync with % toggle

1. Apply Percent from the dropdown → the `%` toolbar button renders
   pressed.
2. Clear with Automatic, then press the `%` toolbar button → reopened
   dropdown marks Percent.

## 5. Decimal bumps on new formats

1. Cell `1234.5` formatted as Number (`1,234.50`).
2. Click ".00+" (increase) → `1,234.500` (2 → 3, never 2 → 1).
3. Click ".0-" twice → `1,234.50` then `1,234.5`.

## 6. Text unaffected

1. Type `hello` in a cell, apply Currency → still shows `hello`.

## 7. Undo

1. Cell `1234.5`, apply Currency (`$1,234.50`).
2. Ctrl/Cmd+Z → back to `1234.5`; redo → `$1,234.50` again.

## 8. Popover behavior

1. Open the dropdown, click elsewhere on the grid → menu closes, grid
   keeps keyboard focus (arrow keys still move the selection).
