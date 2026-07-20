# REQ: date-time-formats

## Problem

The toolbar format dropdown covers only numeric formats (Number, Percent,
Scientific, Currency). Users coming from Google Sheets / Excel expect the
same menu to offer Date, Time, Date time, and Duration formats — and they
expect typing a date like `9/26/2008` or a time like `3:59 PM` into a cell
to produce a real date value (sortable, filterable, usable in arithmetic),
not inert text. Today such input is stored as a plain string, so no display
format could ever apply to it.

This supersedes the "no date/time/duration formats" non-goal recorded in
`req-format-dropdown` (2026-07-19).

## Requirement

- Date and time values are represented as Excel-style serial numbers: the
  integer part is days since the epoch 1899-12-30 (UTC), the fractional
  part is the fraction of a 24-hour day. No new cell value type is added;
  a date cell holds a plain number.
- The format dropdown gains four rows appended after Currency, in this
  order, each with a right-aligned example:
  - Date — example `9/26/2008`
  - Time — example `3:59:00 PM`
  - Date time — example `9/26/2008 15:59:00`
  - Duration — example `24:01:00`
- New formats render a numeric cell value as follows (`decimals` has no
  effect on these four formats):
  - Date: `M/D/YYYY` from the serial's UTC calendar date (no zero
    padding), e.g. `39717` → `9/26/2008`.
  - Time: `h:mm:ss AM/PM` from the serial's day fraction, e.g.
    `39717.66597` → `3:59:00 PM`; `0.5` → `12:00:00 PM`.
  - Date time: `M/D/YYYY H:MM:SS` with 24-hour zero-padded time, e.g.
    `39717.66597` → `9/26/2008 15:59:00`.
  - Duration: cumulative `H:MM:SS` where hours may exceed 23, from the
    serial as a day count, e.g. `1.75` → `42:00:00`; negative values
    render with a leading `-` (e.g. `-1.5` → `-36:00:00`).
  - Date, Time, and Date time formatted cells whose value cannot be a
    valid serial (negative, or non-finite) fall back to the default
    (unformatted) rendering.
- Typing an unambiguous date/time literal into a cell stores its serial
  number (not text) and auto-applies the matching format to that cell when
  the cell has no explicit number format yet:
  - ISO date `YYYY-M-D` (e.g. `2008-09-26`) and US date `M/D/YYYY`
    (e.g. `9/26/2008`) → serial integer, Date format.
  - Time `h:mm`, `h:mm:ss`, each optionally with ` AM`/` PM` (case
    insensitive) → day-fraction serial, Time format. 24-hour values
    (hours 0–23) are accepted without AM/PM.
  - Combined `<date> <time>` (either date form, either time form) →
    full serial, Date time format.
  - Only real calendar dates and clock times parse (month 1–12, day valid
    for that month/year, hours 0–23 or 1–12 with AM/PM, minutes/seconds
    0–59). Anything else (e.g. `13/45/2026`, `25:99`) stays text.
- Date-literal entry behaves like any other edit: the raw text as typed is
  preserved for re-editing and the formula bar, the stored value is the
  serial, one undo step reverts both the value and any auto-applied
  format, and `onChange` reports the serial as the cell value.
- Because date cells are numbers, existing behavior follows with no
  special cases: formula arithmetic (`=A1+1` is the next day), sorting is
  chronological, filters group equal serials, and structural edits /
  copy-paste of raw text round-trip the literal.
- The dropdown check mark, Automatic reset, and outside-click/menu-close
  behavior extend to the four new rows exactly as for existing formats.
- The `.00+` / `.0-` decimal buttons leave Date, Time, Date time, and
  Duration display unchanged.

## Acceptance Criteria

- [x] The dropdown lists nine rows in order Automatic, Number, Percent,
      Scientific, Currency, Date, Time, Date time, Duration, with the
      examples above; check mark and Automatic behavior work on the new
      rows.
- [x] A cell holding `39717.66597` displays `9/26/2008` with Date,
      `3:59:00 PM` with Time, `9/26/2008 15:59:00` with Date time; a cell
      holding `1.75` displays `42:00:00` with Duration and `-1.5`
      displays `-36:00:00`.
- [x] Typing `2008-09-26` into an unformatted cell displays `9/26/2008`,
      stores value `39717`, auto-applies Date; the formula bar still
      shows `2008-09-26`.
- [x] Typing `9/26/2008 15:59` displays `9/26/2008 15:59:00` with Date
      time auto-applied; typing `3:59 PM` displays `3:59:00 PM` with Time
      auto-applied.
- [x] Typing a date into a cell that already has an explicit number
      format (e.g. Currency) stores the serial but keeps that format.
- [x] `13/45/2026`, `25:99`, and `1234.5` do not parse as dates (the
      first two stay text, the third stays a plain number with no
      auto-format).
- [x] One undo after typing `2008-09-26` restores both the previous cell
      content and the previous (absent) format.
- [x] With A1 = `2008-09-26`, a cell `=A1+1` formatted as Date displays
      `9/27/2008`.
- [x] Sorting a column of date cells orders them chronologically; the
      column filter popup groups two cells typed as `2008-09-26` and
      `9/26/2008` as one value entry.
- [x] The `.00+` button on a Date-formatted cell leaves its display
      unchanged.
- [x] A Date-formatted cell holding `-5` renders as plain `-5`.
- [x] Unit tests cover serial↔date conversion, all four renderings
      (including duration > 24h and negative duration), literal parsing
      accept/reject cases, and auto-format application incl. undo.
- [x] `npm run typecheck`, `npm run test`, and `npm run build` pass.

## Constraints

- Extend the existing `NumFmt` union; no new `CellStyle` field, no new
  `CellValue` type.
- All date math in UTC — rendering and parsing must not shift with the
  host timezone or DST.
- `getDisplay` / `formatNumber` remain the single display path;
  `parseLiteral` (or a helper on its single call path in `applyRaw` /
  `setCells`) remains the single parse path. Number parsing keeps
  precedence: anything `Number()` accepts today still parses as today.
- Auto-format must ride the same undo patch batch as the raw change
  (`raw` + `style` patches already coexist in one batch).
- Pre-1900 serials are not required to match Excel's off-by-one around
  the fictitious 1900-02-29; epoch consistency (serial ↔ our own
  rendering round-trip) is the requirement.
- en-US conventions only (`M/D/YYYY`, AM/PM), matching the existing `$`
  / en-US constraint.

## Non-Goals

- No date formula functions (DATE, NOW, TODAY, …) and no date literals in
  formulas.
- No 2-digit-year parsing, no month-name parsing (`Sep 26`), no
  `D/M/YYYY` locale order, no duration-literal input parsing.
- No custom date format strings and no additional variants (long date,
  ISO display, fractional seconds).
- No date-aware rendering in the filter popup or formula bar (they keep
  showing raw/unformatted values, as they do for percent/currency).
- No changes to TSV copy semantics beyond what raw-text round-trip
  already provides.
