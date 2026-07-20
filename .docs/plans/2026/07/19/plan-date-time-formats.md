# Plan: date-time-formats

## Goal

The format dropdown offers Date / Time / Date time / Duration rendering of
Excel-style serial numbers, and typing an unambiguous date/time literal
stores its serial with the matching format auto-applied in the same undo
step, per `req-date-time-formats`.

## Current Context

- `src/types.ts` — `NumFmt` currently `"general" | "percent" | "thousands"
  | "number" | "currency" | "scientific"`.
- `src/state/GridStore.ts:720` — `applyRaw` is the single non-formula
  write funnel; it calls `parseLiteral(raw)` (exported, `:1006`) at
  `:743`. `applyRaw` is also used by undo/redo replay (`:662-676`) and
  structural rewrites (`:533`), so auto-format must NOT live inside
  `applyRaw` (it would re-fire during replay).
- `src/state/GridStore.ts:312` — `setCells` builds one `Patch[]` batch of
  `{kind:"raw"}` patches; `applyStyle` (`:353`) builds `{kind:"style"}`
  patches. Undo replays by patch kind, so raw + style patches can share
  one batch — the hook point for auto-format.
- `src/state/GridStore.ts:972` — `formatNumber(v, style)` single display
  path; `getDisplay` gates it on numeric values.
- `src/components/Toolbar.tsx` — `FORMAT_ITEMS` menu rows;
  `FMT_DEFAULT_DECIMALS` drives `bumpDecimals` base.
- `src/utils/` — home of small pure helpers (`cellRef.ts`, `tsv.ts`) with
  sibling `.test.ts` files; a new `dateSerial.ts` fits the pattern.
- Known unknown: whether `parseLiteral`'s trim behavior interacts with
  date strings containing a space (datetime) — Phase 1 confirms
  `Number(" 9/26/2008 15:59 ")` is NaN so precedence is safe.

## Decisions

- **Serial model**: epoch `Date.UTC(1899,11,30)`; serial = (utcMs −
  epoch) / 86 400 000. All conversions in UTC; no `new Date(y,m,d)`
  local-time calls anywhere. Pre-1900 Excel off-by-one is accepted
  (round-trip consistency is the contract, per REQ).
- **New util `src/utils/dateSerial.ts`** exporting pure functions:
  - `dateToSerial(y, m, d, hh=0, mm=0, ss=0): number`
  - `serialToUTCParts(serial): {y,m,d,hh,mm,ss}` (seconds rounded, carry
    into minutes/hours/days so `x:59:59.9` → next `:00:00`)
  - `formatDateSerial(v, kind: "date"|"time"|"datetime"|"duration"):
    string | null` (null when not renderable: negative/non-finite for
    date/time/datetime)
  - `parseDateTimeLiteral(trimmed: string): {serial: number, fmt:
    "date"|"time"|"datetime"} | null` — strict regexes + calendar
    validation per REQ; returns null otherwise.
  Rationale: keeps GridStore.ts from growing ~150 lines; independently
  unit-testable like cellRef/tsv.
- **formatNumber**: four new cases delegate to `formatDateSerial`.
  A `null` result must explicitly return the default rendering
  (`d === undefined ? String(v) : v.toFixed(d)`) — a bare `break` would
  NOT reach the switch's `default` branch. `formatDateSerial` returns
  null for negative/non-finite date/time/datetime AND for non-finite
  duration (negative duration renders with a leading `-`). `decimals` is
  ignored by these cases.
- **Parsing precedence**: `parseLiteral` keeps its current order —
  `Number()` first, then booleans, then NEW `parseDateTimeLiteral`, then
  string. `9/26/2008` is NaN for `Number()` so no existing numeric input
  changes meaning. `parseLiteral` itself returns only the value (its
  contract is unchanged); it stores the serial.
- **Auto-format lives in `setCells`**: after `applyRaw`, if the new raw is
  a non-formula literal, `parseDateTimeLiteral(raw.trim())` is consulted
  (single extra call only for cells whose parsed value is a number and
  raw is not pure-numeric — cheap); when it hits and the cell's current
  style has no `numFmt`, push a `{kind:"style"}` patch setting `numFmt`
  into the same `patches` batch and update the style map. Undo/redo then
  reverts value + format atomically with zero replay special-casing
  (replay uses patches, never re-detection). Structural rewrites (`:533`)
  and undo replay call `applyRaw` directly and are untouched.
- **Duplicate parse call accepted**: `applyRaw` (via `parseLiteral`) and
  `setCells` (for format detection) each run the date regexes on matching
  cells. Alternative — `parseLiteral` returning a tuple — rejected: it is
  a public export whose signature would break for a micro-optimization on
  a per-keystroke path.
- **Toolbar**: append four `FORMAT_ITEMS` rows (labels Date, Time, "Date
  time", Duration; examples from REQ). `FMT_DEFAULT_DECIMALS` gets no new
  entries (base 0 is correct; decimals is ignored in rendering anyway).
  No other toolbar changes.
- Rejected: new CellValue type, filter/formula-bar date rendering, TSV
  changes, locale options, feature flags — out of REQ scope.
- E2E coverage: yes — user-facing input + toolbar flow. New spec
  `.docs/tests/test-date-time-formats.md`.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Confirm `Number()` rejects every literal `parseDateTimeLiteral` will
      accept (spot-check `"9/26/2008"`, `"2008-09-26"`, `"3:59"`,
      `"9/26/2008 15:59"`) so numeric precedence is preserved.
- [x] Confirm undo replay (`GridStore.ts:660-676`) applies `style` patches
      by kind so a mixed raw+style batch reverts atomically.
- [x] Confirm `getRaw` / formula bar read `rec.raw` so typed literals
      round-trip for re-editing.
- [x] Record non-goals: no date functions, no 2-digit years or month
      names, no filter-popup date rendering, no TSV changes.

### Phase 2 - Serial utility

- [x] Create `src/utils/dateSerial.ts` with `dateToSerial`,
      `serialToUTCParts` (with second-rounding carry), `formatDateSerial`
      (M/D/YYYY, h:mm:ss AM/PM, M/D/YYYY H:MM:SS, cumulative ±H:MM:SS),
      and `parseDateTimeLiteral` (ISO date, US date, 12h/24h time,
      combined; strict calendar/clock validation), all UTC-only, with a
      top comment block.
- [x] Create `src/utils/dateSerial.test.ts`: round-trip serial↔parts,
      REQ examples (`39717`, `39717.66597`, `1.75`, `-1.5`), rounding
      carry at `23:59:59.6`, reject cases (`13/45/2026`, `2/30/2026`,
      `25:99`, `1234.5`, `9/26/08`), AM/PM edge cases (12:00 AM →
      serial 0 fraction, 12:00 PM → 0.5).

### Phase 3 - Store integration

- [x] Add `"date" | "time" | "datetime" | "duration"` to `NumFmt` in
      `src/types.ts`; refresh its comment block.
- [x] Extend `formatNumber` in `src/state/GridStore.ts` with the four
      cases delegating to `formatDateSerial`, falling back to the default
      branch on null; refresh the comment block.
- [x] Extend `parseLiteral` to consult `parseDateTimeLiteral` after
      number/boolean checks and store the serial for date literals.
- [x] In `setCells`, after a raw patch for a non-formula literal, when
      `parseDateTimeLiteral` matches and the cell style lacks `numFmt`,
      push a same-batch `{kind:"style"}` patch whose `after` is
      `mergeStyle(before, { numFmt })` — merge, never replace, so an
      existing `decimals`-only style is preserved — and update the
      `styles` map via `setStyleRecord`.
- [x] Verify undo of a typed date literal reverts value and auto-format
      in one step (manual store-level check before formal tests).

### Phase 4 - Toolbar

- [x] Append Date / Time / Date time / Duration rows with REQ examples to
      `FORMAT_ITEMS` in `src/components/Toolbar.tsx`; refresh the comment
      block. Confirm check mark, Automatic, and close behavior need no
      code changes (they key off `activeStyle.numFmt` generically).

### Phase 5 - Tests and verification

- [x] Add GridStore-level tests in `src/state/GridStore.style.test.ts`
      (or a new `GridStore.date.test.ts` if cleaner): literal entry
      stores serial + auto-format, formatted display for all four
      formats, no auto-format over an existing `numFmt`, undo atomicity,
      `=A1+1` next-day display, `.00+` no-op on date display, negative
      serial fallback, sort/filter grouping of equal serials.
- [x] Run `npm run typecheck`, `npm run test`, `npm run build`; record
      output.
- [x] Create `.docs/tests/test-date-time-formats.md` E2E spec: menu rows
      and examples, typing each literal form, auto-format + formula bar
      raw, undo, `=A1+1`, decimal-button no-op, Automatic reset.
- [x] Verify per the E2E spec in the dev-server preview (own
      preview_start session).

### Phase 6 - Documentation and status

- [x] Update plan checkboxes and REQ acceptance criteria from evidence.
- [x] Write `.docs/done/2026/07/19/date-time-formats.md` after commit.

## Validation

- `npm run typecheck` — exits 0.
- `npm run test` — all suites incl. new `dateSerial.test.ts` and store
  date tests pass.
- `npm run build` — succeeds.
- Browser preview: type `2008-09-26`, `9/26/2008 15:59`, `3:59 PM` into
  empty cells → `9/26/2008`, `9/26/2008 15:59:00`, `3:59:00 PM` with
  formats auto-applied (dropdown check marks confirm); `=A1+1` with Date
  → `9/27/2008`; undo reverts entry+format; screenshot as evidence.

## Rollback / Risk

- Biggest behavior change: date-looking text now parses to numbers.
  Existing sheets whose raw text matches the strict patterns will convert
  on next edit of that cell (stored raw is untouched until re-set).
  Mitigation: strict patterns (4-digit years, valid calendar/clock only);
  phone-like strings (`306.221.4054`) and partial dates stay text.
- Auto-format patch rides the standard undo batch — no new undo machinery;
  reverting the commit fully rolls back.
- FP rounding: second-level rounding with carry prevents `:60` artifacts;
  covered by dedicated tests.
- No public API removals; `NumFmt` widening is additive. `parseLiteral`
  signature unchanged (returns serial as a plain number).
- Documented decision: auto-format style patches ride the raw batch and
  are deliberately NOT gated by `STYLE_CELL_CAP` (the raw batch itself is
  uncapped); a huge paste of date literals holds one raw + one style
  patch per cell.
