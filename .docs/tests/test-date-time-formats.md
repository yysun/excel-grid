# E2E: date-time-formats

Manual/browser scenarios for the toolbar "More formats" dropdown's new
Date / Time / Date time / Duration rows and date-literal input. Run
against the demo app (`npm run dev` / launch config `demo`).

## 1. Menu contents

1. Click the "123 ▾" toolbar button.
2. Expect, after Currency, four more rows in order: Date (`9/26/2008`),
   Time (`3:59:00 PM`), Date time (`9/26/2008 15:59:00`), Duration
   (`24:01:00`).

## 2. Typing a date auto-formats

1. In an empty cell, type `2008-09-26`, press Enter.
2. Reselect the cell → displays `9/26/2008`.
3. Formula bar shows the typed raw text `2008-09-26`.
4. Open the "123" menu → check mark on Date.

## 3. Typing a datetime / time literal

1. Empty cell: type `9/26/2008 15:59`, Enter → displays
   `9/26/2008 15:59:00`; dropdown marks Date time.
2. Empty cell: type `3:59 PM`, Enter → displays `3:59:00 PM`; dropdown
   marks Time.

## 4. Existing format is not overridden

1. Apply Currency to an empty cell (via dropdown).
2. Type `2008-09-26` into that same cell, Enter.
3. Cell keeps Currency rendering of the date's serial (`$39,717.00`), not
   Date formatting.

## 5. Invalid literals stay text / plain numbers

1. Type `13/45/2026` → stays literal text, no format applied.
2. Type `25:99` → stays literal text.
3. Type `1234.5` → plain number, no auto-format.

## 6. Undo

1. Empty cell, type `2008-09-26`, Enter.
2. Ctrl/Cmd+Z once → cell is empty again (both value and Date format
   gone).
3. Redo → `9/26/2008` reappears with Date format.

## 7. Formula arithmetic

1. Cell A1 = `2008-09-26`.
2. Cell A2 = `=A1+1`, apply Date format to A2.
3. A2 displays `9/27/2008`.

## 8. Decimal buttons are a no-op on date formats

1. Cell formatted as Date showing `9/26/2008`.
2. Click ".00+" → display unchanged.

## 9. Negative serial fallback

1. Type `-5` into a cell, apply Date format.
2. Displays plain `-5`, not a date.

## 10. Sort and filter grouping

1. Column with `2026-01-01`, `1999-12-31`, `2010-06-15` (as literals).
2. Click the column's sort button (ascending) → order becomes
   `1999-12-31`, `2010-06-15`, `2026-01-01`.
3. Enable the column filter; the popup shows one entry per distinct date
   (cells typed as `2008-09-26` and `9/26/2008` in different rows collapse
   to a single entry).
