# REQ: format-dropdown

## Problem

The toolbar exposes number formatting only as two toggle buttons (percent,
thousands separator) plus decimal bump buttons. There is no menu that names
the available formats, previews what each looks like, or offers common
formats like currency or scientific notation. Users coming from Google
Sheets / Excel expect a "123"-style format dropdown that lists formats with
example output and a mark on the currently active one.

## Requirement

- The toolbar gains a format dropdown button (label "123" with a caret,
  tooltip "More formats"), placed with the existing number-format controls
  (before the % / thousands toggle buttons).
- Clicking the button opens a dropdown menu (same popover behavior as the
  existing font-size and freeze menus: closes on outside click and does
  not steal grid focus).
- The menu lists these formats, each as one row with the format name and a
  right-aligned example rendered in the menu:
  - Automatic — no example; resets the cell to default display.
  - Number — example `1,000.12` (thousands separators, 2 decimals).
  - Percent — example `10.12%` (existing percent format).
  - Scientific — example `1.01E+3` (2 decimals).
  - Currency — example `$1,000.12` (dollar sign, thousands separators,
    2 decimals).
- Selecting a format applies it to every cell of the current selection and
  closes the menu; selecting "Automatic" removes any number format and any
  decimal-places override from the selection.
- The menu shows a check mark on the row matching the active cell's current
  format ("Automatic" is marked when the active cell has no number format).
- New formats render numeric cell values as follows (`decimals` style still
  overrides the default digit count, adjusted by the existing .00+ / .0-
  buttons):
  - Number: thousands separators with exactly `decimals ?? 2` fraction
    digits (e.g. `1234.5` → `1,234.50`).
  - Currency: `$` prefix, then Number rendering (e.g. `1234.5` →
    `$1,234.50`); negative values render like `-$1,234.50`.
  - Scientific: uppercase exponent with `decimals ?? 2` fraction digits
    (e.g. `1234.5` → `1.23E+3`).
- Existing percent and thousands formats keep their current rendering and
  their toolbar toggle buttons; the dropdown's Percent row applies the same
  format the % toggle applies, and both UIs reflect the same state.
- Non-numeric cell values (text, booleans, errors) are unaffected by the
  new formats, matching how percent/thousands behave today.
- Formats applied via the dropdown participate in undo/redo, copy of style
  via clear-format, and persistence in `CellStyle` exactly like the
  existing `numFmt` values.

## Acceptance Criteria

- [x] Toolbar shows a "123" caret button with tooltip "More formats" in the
      number-format group; clicking it opens a menu listing Automatic,
      Number, Percent, Scientific, Currency with the examples above.
- [x] With a cell containing `1234.5` selected, choosing Number displays
      `1,234.50`, Currency displays `$1,234.50`, Scientific displays
      `1.23E+3`, Percent displays `123450%`.
- [x] Choosing Automatic on a formatted cell restores plain `1234.5`
      display and clears both `numFmt` and `decimals` from its style.
- [x] The menu check mark tracks the active cell: it marks the current
      format, and marks Automatic when no format is set.
- [x] The % toggle button shows pressed when Percent was chosen from the
      dropdown, and the dropdown marks Percent when the % toggle set it.
- [x] The .00+ / .0- buttons adjust displayed fraction digits for Number,
      Currency, and Scientific formatted cells.
- [x] A negative value formatted as Currency renders as `-$…`, not `$-…`.
- [x] Text cells keep their display when a format is applied to them.
- [x] Applying a format is undoable: undo restores the previous display and
      style.
- [x] Menu closes on outside click and after choosing an item, without
      moving focus away from the grid.
- [x] Unit tests cover `formatNumber` for number, currency (including
      negative), and scientific, with default and overridden decimals.
- [x] `npm run typecheck`, `npm run test`, and `npm run build` pass.

## Constraints

- Extend the existing `NumFmt` union / `CellStyle.numFmt` model; no new
  parallel style field and no change to stored style shape beyond new union
  members.
- `getDisplay` / `formatNumber` remain the single formatting path; filters
  and sorting keep comparing computed values, not formatted text.
- Follow existing toolbar popover conventions (`xg-` CSS classes in
  `src/styles.css`, inline SVG icons, `mousedown` prevention, no new
  dependencies).
- Currency symbol is a fixed `$` (en-US formatting already used by the
  thousands format).

## Non-Goals

- No date, time, duration, accounting, or financial formats (cell model has
  no date type).
- No "Plain text" format that changes how raw input is parsed.
- No custom format strings or a "Custom number format" dialog.
- No locale/currency selection; `$` and en-US grouping only.
- No removal or relocation of the existing %, thousands, and decimal
  buttons.
