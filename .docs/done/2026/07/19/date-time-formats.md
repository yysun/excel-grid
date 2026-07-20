# Done: date-time-formats

## Summary

- Added Date, Time, Date time, and Duration rows to the toolbar's "More
  formats" dropdown, rendering Excel-style serial numbers (days since
  1899-12-30 UTC, all math UTC-only) via a new `src/utils/dateSerial.ts`
  helper (`dateToSerial`, `serialToUTCParts`, `formatDateSerial`,
  `parseDateTimeLiteral`).
- Typing an unambiguous date/time literal (ISO `2008-09-26`, US
  `9/26/2008`, times with optional AM/PM, or a `<date> <time>` combo) now
  stores its serial and auto-applies the matching format — but only when
  the cell has no existing `numFmt`, so a pre-formatted cell (e.g.
  Currency) keeps its format over the date's serial.
- The auto-format style patch rides the same undo batch as the raw-text
  edit (`setCells`), so one undo reverts both the value and the format
  atomically. Undo replay and structural-edit rewrites call `applyRaw`
  directly and never re-run detection, so replay can't diverge from the
  original edit.
- Because a date cell is a plain number, formula arithmetic, sorting, and
  filter grouping all work with zero special-casing; the filter popup
  intentionally shows raw serials, not formatted dates (per REQ non-goal).
- Negative/non-finite serials fall back to plain numeric rendering for
  Date/Time/Date time; Duration renders negatives with a leading `-`.

## Verification

- `npm run typecheck`, `npm run test` (9 files, 138 tests — including 12
  new `dateSerial.test.ts` cases and 8 new `GridStore.date.test.ts`
  cases), and `npm run build` all pass.
- Independent AR (pre-implementation) and CR (post-implementation)
  subagent reviews: no blocking flaws. AR's five gotchas (switch
  fallthrough, style merge-not-replace, decimals base for bump, etc.) were
  folded into the plan before coding; CR's one actionable finding (a
  stale test-file header comment) was fixed.
- Extensive live browser E2E on the demo app per
  `.docs/tests/test-date-time-formats.md`: menu contents/examples/check
  marks; typing each literal form (ISO date, combined datetime, bare
  AM/PM time) with correct auto-format and formula-bar raw text; an
  existing Currency format surviving a date literal; three reject cases
  staying text/plain-number; a full undo→redo cycle confirmed atomic via
  the dropdown check mark; `=A1+1` on a date cell; `.00+` no-op on Date
  display; a negative Date-formatted cell falling back to plain `-5`; and
  the column filter popup listing distinct raw serials correctly.
- Sort behavior (AC: chronological ordering) is covered by the
  `GridStore.date.test.ts` `sortRange` test rather than repeated live —
  the toolbar's header sort button sorts the entire used range (pre-
  existing behavior from an earlier story), and re-running it against the
  1,328-row demo dataset risked reordering unrelated demo data; a single
  undo confirmed it's fully reversible when it was exercised once to
  confirm the mechanism.

## Notes

- `parseDateTimeLiteral` runs twice per matching literal edit (once
  inside `parseLiteral` for the value, once in `setCells` for auto-format
  detection) — a deliberate, cheap tradeoff documented in the plan rather
  than changing `parseLiteral`'s public signature.
- Non-goals unchanged: no date formula functions, no 2-digit years or
  month-name parsing, no custom format strings, no date-aware filter
  popup or formula bar rendering.
