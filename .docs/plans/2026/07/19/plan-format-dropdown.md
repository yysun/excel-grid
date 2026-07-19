# Plan: format-dropdown

## Goal

The toolbar has a Google Sheets-style "123" format dropdown listing
Automatic / Number / Percent / Scientific / Currency with example output
and a check mark on the active format, and `formatNumber` renders the three
new formats (number, currency, scientific) with `decimals` overrides, per
`req-format-dropdown`.

## Current Context

- `src/types.ts:37` — `NumFmt = "general" | "percent" | "thousands"`;
  `CellStyle.numFmt` / `CellStyle.decimals` already exist.
- `src/state/GridStore.ts:972` — `formatNumber(v, style)` is the single
  display-formatting path, called from `getDisplay` only for numeric
  values. Exported, so unit-testable directly.
- `src/components/Toolbar.tsx` — `toggleFmt(fmt)` applies/toggles
  `numFmt` via `store.applyStyle` (undoable); popover pattern: `Popover`
  union state + `xg-tb-group` wrapper + outside-mousedown close; existing
  menus use `xg-tb-pop xg-tb-menu` with `xg-tb-menu-item` buttons.
- `src/styles.css` — `.xg-tb-menu` (min-width 132px) and
  `.xg-tb-menu-item` already style dropdown menus; a format row needs a
  name + right-aligned example + leading check column, so a small amount
  of new CSS is needed.
- `src/state/GridStore.style.test.ts` — existing style/format unit tests,
  the natural home for new `formatNumber` cases.
- `applyStyle` with `numFmt: undefined` / `decimals: undefined` deletes
  those keys (`mergeStyle`), which is exactly what "Automatic" needs.
- Known unknown: none material — no date model, so the format list is
  numeric-only by REQ.

## Decisions

- Extend the existing `NumFmt` union with `"number" | "currency" |
  "scientific"` instead of adding any new style field. Stored styles stay
  shape-compatible; old values keep meaning.
- Rendering (in `formatNumber`):
  - `number`: `v.toLocaleString("en-US", { minimumFractionDigits: d ?? 2,
    maximumFractionDigits: d ?? 2 })` — differs from `thousands` (which
    defaults to free-form digits) by fixing 2 decimals.
  - `currency`: `-$` + number-rendering of `|v|` for negatives, `$` +
    number rendering otherwise (sign must precede the `$`).
  - `scientific`: `v.toExponential(d ?? 2).toUpperCase()` → `1.23E+3`.
- Dropdown applies formats non-toggling (like Google Sheets: choosing the
  active format again is a no-op reapply, not a removal); "Automatic"
  is the explicit removal path and clears `numFmt` and `decimals` in one
  `applyStyle` patch. The % / thousands toolbar buttons keep their toggle
  behavior — both read the same `activeStyle.numFmt`, so states stay in
  sync automatically.
- Menu rows are static labels + hardcoded example strings from the REQ
  (`1,000.12`, `10.12%`, `1.01E+3`, `$1,000.12`) rather than live
  `formatNumber` calls — the examples are fixed by the REQ and avoid
  coupling menu text to a sample value.
- `bumpDecimals` currently starts from `decimals ?? 0`; for the new
  formats whose default display is 2 decimals, the first "increase" press
  would jump 2 → 1. Fix: base the bump on the format's effective default
  (`2` for number/currency/scientific, `0` otherwise), preserving existing
  behavior for general/percent/thousands.
- New popover id `"fmt"` in the existing `Popover` union; reuse
  `xg-tb-pop xg-tb-menu` and `xg-tb-menu-item`, adding modifier CSS for
  the check column and right-aligned example (new classes
  `xg-tb-fmt-item`, `xg-tb-fmt-example`, `xg-tb-fmt-check`).
- Rejected: a separate "format" style field, custom format strings,
  locale/currency options, feature flags, config props — all out of REQ
  scope. No new dependencies.
- E2E coverage: yes — user-facing toolbar flow. Spec at
  `.docs/tests/test-format-dropdown.md`, exercised via the demo app in the
  browser preview.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect `src/components/Toolbar.tsx` popover pattern (`Popover`
      union, outside-click close, `xg-tb-group`) to confirm the dropdown
      can reuse it unchanged.
- [x] Inspect `formatNumber` / `getDisplay` in `src/state/GridStore.ts` to
      confirm all display formatting flows through one function and only
      for numeric values.
- [x] Confirm `mergeStyle` deletes keys on `undefined` so Automatic can
      clear `numFmt` + `decimals` via one `applyStyle` call.
- [x] Record non-goals: no date/text/custom formats, no locale options, no
      relocation of existing %/,/decimal buttons.

### Phase 2 - Foundation changes (types + formatting)

- [x] Update `NumFmt` in `src/types.ts` to add `"number" | "currency" |
      "scientific"`, and refresh the file's top comment block.
- [x] Extend `formatNumber` in `src/state/GridStore.ts` with `number`,
      `currency` (negative-sign-before-`$`), and `scientific` cases using
      `decimals ?? 2`; refresh the file's top comment block.

### Phase 3 - Feature implementation (toolbar dropdown)

- [x] In `src/components/Toolbar.tsx`, add `"fmt"` to the `Popover` union
      and render a "123"+caret button (tooltip "More formats") inside an
      `xg-tb-group`, placed before the % toggle in the number-format
      group.
- [x] Render the menu (`xg-tb-pop xg-tb-menu`) with rows Automatic /
      Number / Percent / Scientific / Currency: check column marking the
      active cell's format (Automatic when `numFmt` unset), name, and
      right-aligned example per REQ.
- [x] Wire row clicks: format rows call `store.applyStyle(selRange,
      { numFmt })` and close the menu; Automatic applies `{ numFmt:
      undefined, decimals: undefined }` and closes. Refresh the file's top
      comment block.
- [x] Update `bumpDecimals` in `src/components/Toolbar.tsx` to base the
      bump on the active format's default fraction digits (2 for
      number/currency/scientific, 0 otherwise) so "increase" never lowers
      the displayed digit count.
- [x] Add `xg-tb-fmt-item` / `xg-tb-fmt-example` / `xg-tb-fmt-check` CSS
      to `src/styles.css` following existing `xg-tb-menu-item` styling.
- [x] Confirm no toggle behavior, feature flags, or extra formats crept in
      beyond the REQ list.

### Phase 4 - Tests and verification wiring

- [x] Add `formatNumber` unit tests in
      `src/state/GridStore.style.test.ts`: number default/override
      decimals, currency positive + negative, scientific default/override,
      and Automatic-style absence (no `numFmt`) unchanged; assert a text
      cell's display is unchanged when a new-format `numFmt` is applied to
      it (AC8 explicit).
- [x] Run `npm run typecheck`, `npm run test`, `npm run build`; record
      pass/fail output.
- [x] Create `.docs/tests/test-format-dropdown.md` E2E spec covering menu
      contents, applying each format to `1234.5`, Automatic reset,
      check-mark sync with the % toggle, decimal bump on new formats, and
      undo.
- [x] Verify in the dev-server preview per the E2E spec (menu opens,
      formats render as specified, outside click closes).

### Phase 5 - Documentation and status

- [x] Update plan checkboxes and REQ acceptance criteria from evidence.
- [x] Write `.docs/done/2026/07/19/format-dropdown.md` after commit stage.

## Validation

- `npm run typecheck` — exits 0.
- `npm run test` — all vitest suites pass, including new `formatNumber`
  cases.
- `npm run build` — library build succeeds.
- Browser preview (demo via `.claude/launch.json`): enter `1234.5`, apply
  each menu format, observe `1,234.50`, `$1,234.50`, `1.23E+3`,
  `123450%`, then Automatic → `1234.5`; check mark and % toggle stay in
  sync; screenshot as evidence.

## Rollback / Risk

- Purely additive union members: old stored styles render exactly as
  before; `default` branch of `formatNumber` unchanged. Reverting the
  commit fully rolls back.
- Risk: `toLocaleString` grouping for very large/small numbers is
  environment-stable for en-US; scientific uses `toExponential`, no
  locale dependency.
- No migrations, no persistence-format change, no public API removal
  (NumFmt widening is backward-compatible for TS consumers).
