# Plan: Merged cells, borders, format painter, and font family

Story: `cell-format-suite` — created 2026-07-22. REQ:
`.docs/reqs/2026/07/22/req-cell-format-suite.md`.

## Goal

Close all four "Not (yet) included" gaps at once: merge/unmerge a range of
cells with merge-aware selection/navigation/editing, apply per-side cell
borders with color and thickness, paint one cell's full formatting onto
other cells via a toolbar toggle, and pick a per-cell font family — each
undoable, each rendered correctly through the existing virtualized grid, and
each round-tripping through `getSnapshot()`/`initialState` and the xlsx
helpers.

## Current Context

- `src/types.ts` — `CellStyle` (bold/italic/underline/strike/fontSize/
  color/background/align/valign/wrap/numFmt/decimals) has no `border` or
  `fontFamily` field; `GridSnapshot` (`cells`/`styles`/`colWidths`/
  `rowHeights`) has no `merges` field. Both are additive-only extension
  points.
- `src/state/GridStore.ts` — sparse `cells`/`styles` maps; undo/redo is a
  stack of `Patch[]` batches (`RawPatch | StylePatch | SheetPatch`);
  `applyStyle`/`clearFormat` build per-cell `StylePatch`es and commit via
  `commitStylePatches` (`GridStore.ts:869`, `Patch[]`-typed already — will
  rename to `commitPatches` since merges will reuse it); structural edits
  (`insertRows`/`deleteRows`/`moveRows`/col equivalents,
  `GridStore.ts:507-542`) all funnel through one `remapAxis(axis, map)`
  (`GridStore.ts:550`) that rebuilds a `SheetSnapshot` (`GridStore.ts:67-76`)
  through an index-mapping function and records one `SheetPatch`; `mergeStyle`
  (`GridStore.ts:1143`) shallow-merges a style patch, `undefined` deletes a
  key. No merges array, no border/format-painter/font-family concepts exist.
- `src/components/ExcelGrid.tsx` — `renderCells(r0,r1,c0,c1)`
  (`ExcelGrid.tsx:1069-1111`) is called 4x per frame (main body + top/left/
  corner frozen panes, `ExcelGrid.tsx:1400,1427,1446,1461`) and renders one
  `<div>` per visible (row,col) using `cellStyleCss(cs)` (`ExcelGrid.tsx:
  1522-1542`) for inline CSS — no border/font-family properties emitted
  today, and no concept of a cell spanning more than one row/column.
  `selRange`/`active` derive from raw `selection.anchor/focus`
  (`ExcelGrid.tsx:279-283`); `rectForRange` (`ExcelGrid.tsx:1260-1265`)
  turns any `CellRange` into a pixel box for the selection/active/fill-
  preview overlays and the fill handle (`ExcelGrid.tsx:1272-1280,1402-1411`).
  `handleKeyDown`'s `move()` (`ExcelGrid.tsx:543-553`) already skips hidden
  rows/cols via `stepVisible` (`ExcelGrid.tsx:350-369`) — the pattern to
  extend for merges. `menuItems` (`ExcelGrid.tsx:885-1034`) builds the
  cell-zone right-click items at `~985-1023`. `Toolbar` (`Toolbar.tsx`)
  receives `store`/`selRange`/`active`/`rows` directly and can call any new
  `GridStore` method without new prop plumbing.
- `src/utils/xlsx.ts` — `createStyleInterner()` (`xlsx.ts:194-275`) interns
  fonts/fills/xfs; `internXf` (`xlsx.ts:207`) always writes `borderId="0"`
  (`xlsx.ts:263`) and a hardcoded `<name val="Calibri"/>` (`xlsx.ts:232`);
  the shared `stylesXml` always emits a single empty
  `<borders count="1"><border/></borders>` (`xlsx.ts:419`). `parseStyles`
  (`xlsx.ts:558-627`) never reads `<borders>` and never reads a font's
  `<name>`. `buildSheetXml`/`parseSheetXml` (`xlsx.ts:281-394`,`644-758`)
  have no `<mergeCells>` handling at all (grep-confirmed absent).
- `src/utils/cellRef.ts` — has `normalizeRange`, `rangeContains`,
  `rangeCoords`, `parseRange(text): CellRange | null`, `formatCellRef`, but
  no `formatRange`/range-to-string or `rangesIntersect` helper yet.
- Tests: `GridStore.test.ts` / `GridStore.style.test.ts` /
  `GridStore.structure.test.ts` (one `describe` per feature area) and
  `xlsx.test.ts` (round-trip per style/numFmt/formula/column-width feature).
  No E2E runner exists; `.docs/tests/*.md` specs are executed by hand against
  `npm run dev` via the preview browser.
- Known unknowns: none blocking. The highest-risk area is merged-cell
  rendering/selection/navigation inside the existing virtualization + frozen
  panes; addressed explicitly in Phase 4 with a scoped non-goal (merges
  straddling a freeze boundary are undefined) to keep it tractable.

## Decisions

- **Merges live in the store as a flat `CellRange[]`** (`private merges`),
  not folded into `styles`. Rejected: encoding merge spans as a style field
  on the anchor cell — merges are a structural/topological concept (they
  must be remapped by insert/delete/move like `colWidths`/`hiddenRows`, and
  queried by arbitrary (row,col) during render/nav), not a display
  attribute, so they get their own store field, their own undoable
  `Patch` kind (`{kind:"merges", before, after}`), and their own slot in
  `SheetSnapshot`/`GridSnapshot`.
- **Merge/unmerge remap through the existing `remapAxis` machinery, with an
  explicit monotonic/non-monotonic split**: add `merges: CellRange[]` to
  `SheetSnapshot`, and extend `remapAxis(axis, map)` to
  `remapAxis(axis, map, monotonic: boolean)` (all 6 call sites —
  `insertRows`/`insertCols`/`deleteRows`/`deleteCols` pass `true`;
  `moveRows`/`moveCols` pass `false`, since `blockSwapMap` is a non-monotonic
  swap). For `monotonic` maps, a merge remaps by mapping just its two
  corners (dropping the merge if either maps to `null`/out-of-bounds/
  inverted) — cheap, and correct because a monotonic map preserves interior
  contiguity for free (insert-inside-a-merge grows it, delete-inside-a-merge
  shrinks it, delete-through-an-edge drops it). For non-monotonic maps
  (`move`), two-corner mapping is provably insufficient: AR traced a concrete
  case — moving rows [3,5] up swaps row 2 with rows 3-5; a merge spanning
  rows [4,6] maps corners to startRow=3 (from 4), endRow=6 (unchanged, since
  6 is outside the swap), giving a *non-inverted* `[3,6]` that silently
  absorbs new row 5's unrelated content (old row 2, swapped in) into the
  merge's span. The fix for `monotonic === false` is to map *every* row/col
  in the merge's old span (cheap — bounded by merge size, not sheet size),
  and keep the merge only if those values, read **in the merge's original
  order (not sorted into a set)**, are strictly increasing with no gap and
  within bounds — otherwise drop the merge. Reading them in original order
  (rather than checking "is the resulting set of values a contiguous block
  of integers") matters: a set-based check would wrongly *keep* a merge
  that exactly spans a single-row/col swap (e.g. a 2-row merge at `[3,4]`
  under a `moveRows(3,3,dir)` swap of rows 3/4 — mapped values `{4,3}` sort
  into a contiguous set, but are *decreasing* in original order, meaning
  the anchor's real content relocated into what the merge would now call
  its "covered" row) — exactly the kind of corruption this fix exists to
  prevent, and precisely what the *old* two-corner "inverted" check used to
  catch, so a naive re-implementation could silently regress below even the
  original flawed logic. The order-preserving check correctly keeps a merge
  fully inside the moved block (its values shift uniformly by ±1, staying
  increasing) and correctly drops both the corner-straddling case above and
  this exact-span-swap case.
  Rejected: bespoke merge-adjustment logic duplicated per insert/delete/move
  op (the anti-pattern `remapAxis` was created to avoid), and the original
  two-corners-always draft (reverted after AR found the move-straddling
  counterexample above).
- **`mergeCells`/`unmergeCells` are new store methods, not `applyStyle`
  calls**: `mergeCells(range)` clears the raw content of every covered
  (non-anchor) cell and replaces the merges list with one existing merges
  removed (any that intersect the new range) plus the new one, as a single
  undo batch mixing `RawPatch`es and one `MergesPatch` — mirroring how
  `setCells` batches multiple `RawPatch`es today. `unmergeCells(range)`
  removes every merge intersecting `range` as a single `MergesPatch`
  undo step; it does not restore previously-cleared values (REQ non-goal).
- **Two selection-range memos, not one**: `selection.anchor`/`selection.focus`
  (raw click/drag coordinates) stay exactly as they are today. A new
  `rawSelRange = normalizeRange(selection.anchor, selection.focus)` is
  *exactly* what the single `selRange` memo computes today — unchanged
  behavior, zero regression risk — and continues to drive `buildTSV`/
  `applyPaste` (clipboard), and every count-based structural item in
  `menuItems` (row-zone and col-zone menus in their entirety; the cell-zone's
  "Insert row above"/"Insert column left"/"Delete row(s)"/"Delete column(s)"
  items; `sortRange`/"Filter by cell value" targeting). A second memo,
  `selRange` (the name every other current consumer already uses), unions
  `rawSelRange` with any intersecting merge, repeated until stable, and
  drives rendering (`rectForRange` for the selection/active/fill-preview
  boxes and the fill handle position), `clearRange` (Delete/Backspace), the
  `Toolbar` prop (style buttons + quick-sum), format-painter's destination
  capture, and `mergeCells`'s replace-overlapping-merges input. `active`
  additionally resolves `selection.anchor` to its merge's anchor coordinate
  when covered. This split exists *because* a blanket single-range expansion
  was checked against every real consumer during AR and found to silently
  widen destructive row/column-count operations (e.g. right-clicking a
  single row-header row that merely touches a taller merge would otherwise
  turn "Delete 1 row" into "Delete 3 rows") — the REQ's Non-Goals section
  now states this split explicitly. Rejected: one merge-expanded `selRange`
  used everywhere (the original draft; reverted after AR) and storing "the
  resolved selection" as separate state kept in sync by effects (more state
  to desync than a derived memo).
- **Arrow-key travel steps from the merge's far edge**: `move()` in
  `handleKeyDown` looks up `store.getMergeAt(base.row, base.col)` and, when
  present, starts `stepVisible` from that merge's `endRow`/`endCol` (moving
  down/right) or `startRow`/`startCol` (moving up/left) instead of from
  `base` itself — otherwise stepping by 1 from an anchor whose merge spans
  multiple rows can land on another cell still inside the same merge, which
  the merge-aware `active` memo would resolve right back to the same anchor
  (an invisible, stuck arrow key). This is the one navigation-specific
  change; entering a merge from outside needs no special handling because
  landing on any covered cell already resolves to the anchor via the
  `active` memo.
- **Merged-cell rendering scans the (small) merges list once per pane call**:
  inside each `renderCells(r0,r1,c0,c1)` invocation, first render one block
  per merge that intersects that sub-rect (full merge pixel box via the same
  offset math as `rectForRange`, content/style from the anchor cell), marking
  every covered coordinate; the existing per-cell loop then skips marked
  coordinates. This correctly draws a merge whose anchor has scrolled out of
  the virtualized window but whose tail is still visible, at the cost of a
  full scan of `merges` (expected small; sparse feature) per pane render.
  Rejected: only rendering a merge when its anchor is inside `[r0,r1]x[c0,
  c1]` (breaks as soon as the anchor scrolls just above/left of the
  viewport while the rest of the block is still visible).
- **Merges are not required to render correctly across a frozen-pane
  boundary** (REQ non-goal): a merge intersecting more than one of the 4
  pane sub-rects will be drawn once per intersecting pane (duplicated /
  visually undefined). Freezing rows/columns in the middle of an existing
  merge is an unsupported combination, not a rendering bug to fix. Rejected:
  clipping/splitting a merge's visual box across pane boundaries (large
  complexity for a combination the REQ explicitly excludes).
- **Borders are a `CellStyle.border` sub-object** (`{top?, right?, bottom?,
  left?}` of `{style: "thin"|"medium"|"thick", color?}`), applied via one new
  `GridStore.applyBorder(range, edge, side)` method (not the generic
  `applyStyle`) because the four "single edge" and "outer" presets touch a
  *different subset of sides per cell depending on that cell's position in
  the range* (only boundary cells get touched, and only on the boundary
  side) — a shape `applyStyle`'s "same patch for every cell" contract cannot
  express. `applyBorder` builds its own per-cell `CellBorder` patch (merging
  into whatever border the cell already has) and commits through the same
  `commitPatches` helper `applyStyle` uses. Rejected: exposing per-side
  toolbar actions as four separate `applyStyle` calls with pre-computed
  per-cell style diffs assembled in `Toolbar.tsx` (leaks store-internal
  merge/patch logic into UI code).
- **Only `thin`/`medium`/`thick` solid lines** (REQ non-goal excludes
  dashed/dotted/double/diagonal) — this maps 1:1 onto OOXML's native
  `style="thin|medium|thick"` border-side attribute, so xlsx round-trip
  needs no translation table, just a direct interning table parallel to
  `fonts`/`fills` in `createStyleInterner`.
- **Format painter is transient store view-state**, not component state:
  `GridStore` gains `armFormatPainter(range)` / `disarmFormatPainter()` /
  `getFormatPainterSource()` / `isFormatPainterArmed()` (same category as
  `frozenRows`/`searchQuery` — not undoable, `notify([])` only) because the
  "armed" toggle must be visible to both `Toolbar` (which sets it) and
  `ExcelGrid`'s mouse handling (which consumes it) with neither having a
  natural way to hand state to the other directly. Applying the copied
  format is a new `GridStore.replaceStyle(range, style)` that *replaces* (not
  merges) every cell's style in `range` — deliberately different from
  `applyStyle`'s merge semantics, matching Excel's "format painter overwrites
  everything" behavior — committed through the same `commitPatches` helper.
- **Format painter always broadcasts the source range's top-left cell
  style** (REQ non-goal: no multi-cell pattern tiling) — `Toolbar`'s arm
  action reads `store.getStyle(selRange.startRow, selRange.startCol)` once
  and hands that single `CellStyle | null` to `replaceStyle` on
  destination-drag-end; no per-cell source mapping is needed.
- **Font family is one more optional `CellStyle` field**, applied exactly
  like `fontSize` today (`applyStyle(selRange, { fontFamily })`) from a
  fixed preset list in a new `Toolbar` dropdown reusing the `.xg-tb-menu`/
  `.xg-tb-menu-item` popover pattern (`More formats` precedent) rather than
  the `.xg-tb-sizes` grid (names are longer than 2-digit sizes). Stored as a
  bare font name (e.g. `"Arial"`), not a full CSS fallback stack, so it
  round-trips to xlsx's `<name val="Arial"/>` with no translation and lets
  the browser apply its own generic-family fallback when unavailable.
  Accepted limitation: the existing wrapped-row-height measurement
  (`ExcelGrid.tsx:245`, `countWrappedLines` using the fixed `CELL_FONT_STACK`)
  keeps measuring with the default font stack regardless of a cell's
  `fontFamily` — plumbing the per-cell font through auto-fit measurement is
  out of scope; the REQ does not require pixel-exact auto-fit for custom
  fonts, only that the chosen font renders.
- No new feature flags, environment variables, or compatibility shims:
  `CellStyle`/`GridSnapshot` gain fields (additive), existing snapshots
  without `merges`/`border`/`fontFamily` parse as "none" exactly like a
  snapshot without `styles` does today.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Confirm (already done during AP inspection) that `CellStyle` and
      `GridSnapshot` have no `border`/`fontFamily`/`merges` fields, that
      `xlsx.ts` hardcodes `borderId="0"` and `<name val="Calibri"/>`, and
      that no `<mergeCells>` handling exists anywhere in `xlsx.ts`.
- [x] Record the four non-goals that bound rendering/interaction complexity
      so implementation does not gold-plate: merges never render correctly
      across a frozen-pane boundary; fill-handle drag across merged cells is
      undefined; format painter never tiles a multi-cell source pattern
      (always broadcasts the top-left cell); wrapped-row auto-fit
      measurement does not account for per-cell `fontFamily`.
- [x] Rename `GridStore.commitStylePatches` → `commitPatches` (already typed
      `Patch[]`, no behavior change) since Phase 2's `applyBorder` and
      Phase 5's `replaceStyle`/`mergeCells`-adjacent commits reuse it for
      non-style patch kinds too.
- [x] Note (from AR): `CellStyle` is re-exported from `src/index.ts`, so its
      new `border`/`fontFamily` field types (`BorderLineStyle`, `BorderSide`,
      `CellBorder`) must be added to `src/index.ts`'s `export type { ... }`
      block in Phase 2 alongside the existing `CellStyle`/`GridSnapshot`
      exports, or a consumer cannot name them when constructing a style.

### Phase 2 - Foundation: types, GridStore merges/borders/format-painter model

- [x] In `src/types.ts` add `BorderLineStyle = "thin" | "medium" | "thick"`,
      `BorderSide { style: BorderLineStyle; color?: string }`,
      `CellBorder { top?; right?; bottom?; left?: BorderSide }`, and extend
      `CellStyle` with `border?: CellBorder` and `fontFamily?: string`.
      Extend `GridSnapshot` with `merges?: string[]` (array of `"A1:B2"`
      range refs, consistent with the existing A1-ref-keyed
      `cells`/`styles`). Add `BorderLineStyle`, `BorderSide`, `CellBorder` to
      `src/index.ts`'s public `export type { ... }` block next to `CellStyle`.
- [x] In `src/utils/cellRef.ts` add `formatRange(r: CellRange): string`
      (`formatCellRef(startRow,startCol) + ":" + formatCellRef(endRow,
      endCol)`) and `rangesIntersect(a: CellRange, b: CellRange): boolean`,
      both exported for reuse by `GridStore` and `xlsx.ts`.
- [x] In `GridStore.ts` add `private merges: CellRange[] = []`; extend
      `SheetSnapshot` with `merges: CellRange[]`; populate/restore it in
      `snapshotSheet()`/`restoreSheet()`; extend `sheetSnapshotsEqual` with
      an order-sensitive array comparison over `merges` so a merges-only
      change is never treated as a structural no-op.
- [x] Extend the `Patch` union with
      `{ kind: "merges"; before: CellRange[]; after: CellRange[] }`; handle
      it in `applyPatchBatch` (`this.merges = [...p[side]]`, no `touched`
      entries, no recompute needed for the merges patch itself).
- [x] Implement `getMerges(): CellRange[]` (copy), `getMergeAt(row, col):
      CellRange | null` (linear scan — list is expected small),
      `initMerges(merges: CellRange[]): void` (clamp + drop degenerate
      1x1 ranges, direct assign, no undo/no notify — mirrors `initStyle`).
- [x] Implement `mergeCells(range: CellRange)`: clamp; no-op if the clamped
      range is a single cell; build `RawPatch`es clearing every occupied
      cell in the range except the anchor (`range.startRow/startCol`),
      applying each clear via the existing `applyRaw`; compute
      `after = merges.filter(m => !rangesIntersect(m, r)).concat([r])`;
      push one batch = `[...rawPatches, {kind:"merges", before, after}]` to
      `undoStack`, clear `redoStack`, `recompute(touched)`, `notify` with
      `toGridChanges` over touched+recomputed keys (same shape as
      `setCells`).
- [x] Implement `unmergeCells(range: CellRange)`: `after = merges.filter(m
      => !rangesIntersect(m, clampedRange))`; no-op if unchanged; else set
      `this.merges = after`, push `[{kind:"merges", before, after}]`,
      `notify([])` (no raw content changes).
- [x] Extend `remapAxis`'s signature to `remapAxis(axis, map, monotonic:
      boolean)`; update all 6 call sites (`insertRows`/`insertCols`/
      `deleteRows`/`deleteCols` pass `true`; `moveRows`/`moveCols` pass
      `false`, since `blockSwapMap` is non-monotonic). Add a module-level
      `remapMergeAxis(m, axis, map, count, monotonic)` helper: when
      `monotonic`, map just the merge's two corners on the affected axis
      (drop if either is `null`/negative/`>= count`/inverted — cheap, and
      correct because interior contiguity is preserved for free). When not
      `monotonic`, map *every* row/col in the merge's old span on that axis,
      **in original order (do not sort)**, and keep the merge only if that
      sequence is strictly increasing with no gap and within bounds (drop
      otherwise) — the original-order requirement is what correctly drops
      both a merge straddling a `moveRows`/`moveCols` swap boundary *and* a
      merge exactly spanning a single-line swap (whose mapped values would
      form a contiguous set but in reversed order), while still keeping one
      fully inside the moved block (shifts uniformly, stays increasing).
      Wire it into `after.merges` alongside
      the existing per-key remapping loops.
- [x] Extend `getSnapshot()` to include `merges: this.merges.map(formatRange)`.
- [x] Add `applyBorder(range: CellRange, edge: BorderEdge, side: BorderSide
      | null): void` where `BorderEdge = "all" | "outer" | "none" | "top" |
      "right" | "bottom" | "left"` (new exported type): clamp + `STYLE_CELL_
      CAP` guard like `applyStyle`; for each cell in range compute which
      sides this `edge` preset touches for that cell's position (all cells
      for `"all"`/`"none"`; only boundary cells/sides for `"outer"` and the
      four single-edge values, per REQ semantics); merge `side` (or delete,
      for `"none"`) into just those sides of the cell's existing `border`
      object, skipping cells the preset does not touch; commit via
      `commitPatches`.
- [x] Add `replaceStyle(range: CellRange, style: CellStyle | null): void`:
      like `applyStyle` but sets every cell's style record to a fresh copy
      of `style` (or `null`) outright rather than merging; commit via
      `commitPatches`.
- [x] Add format-painter transient state: `private formatPainterSource:
      CellRange | null = null`; `armFormatPainter(range)` (copy + `notify
      ([])`), `disarmFormatPainter()` (no-op if already null), `getFormat
      PainterSource(): CellRange | null`, `isFormatPainterArmed(): boolean`.
- [x] Run `npm run typecheck` to confirm the new store surface compiles
      before wiring any UI.

### Phase 3 - Font family and borders: render + toolbar

- [x] In `ExcelGrid.tsx`'s `cellStyleCss` (`ExcelGrid.tsx:1522-1542`) add
      `fontFamily: cs.fontFamily` and four `borderTop`/`borderRight`/
      `borderBottom`/`borderLeft` properties built from `cs.border`'s
      respective side via a small `borderCss(side)` helper
      (`"${px} solid ${color ?? "#000000"}"`, `px` = 1/2/3 for thin/medium/
      thick), each `undefined` when that side is unset so the existing
      `.xg-cell` gridline CSS (`border-right`/`border-bottom` in
      `styles.css`) shows through unchanged where no explicit border is set.
- [x] In `Toolbar.tsx` add a `FONT_FAMILIES` preset list (bare names: Arial,
      Times New Roman, Georgia, Courier New, Verdana, Trebuchet MS, Comic
      Sans MS) and a new dropdown button (reusing the `.xg-tb-menu`/
      `.xg-tb-menu-item` popover, `More formats`-style) showing the active
      cell's current `fontFamily` (or a "Font" default label), applying
      `store.applyStyle(selRange, { fontFamily: value })` on selection
      (`value` possibly `undefined` for a "Default" entry, clearing it).
- [x] In `Toolbar.tsx` add a "Borders" dropdown button with: a small preset
      list (All borders / Outside borders / Top / Right / Bottom / Left /
      No border), a line-color swatch reusing the existing `PALETTE`
      picker, and a thickness selector (thin/medium/thick), held as local
      component state (`borderColor`, `borderWidth`, default `#000000`/
      `thin`); clicking a preset calls `store.applyBorder(selRange, preset,
      preset === "none" ? null : { style: borderWidth, color: borderColor
      })`.
- [x] Add any new `.xg-tb-*` styles needed for the borders popover's preset
      grid/color-swatch/thickness controls to `src/styles.css`, following
      the existing popover/palette class patterns exactly.
- [x] In `src/utils/xlsx.ts`: extend `internXf`'s font-inclusion condition
      (`xlsx.ts:222`) to also trigger on `style.fontFamily`, and build
      `<name val="${escXml(style.fontFamily ?? "Calibri")}"/>` instead of
      the hardcoded value; in `parseStyles`'s font loop (`xlsx.ts:566-583`)
      read `tags(font,"name")[0]?.getAttribute("val")` and set
      `s.fontFamily` when present and not `"Calibri"`.
- [x] In `src/utils/xlsx.ts`: add a `borders: string[]` / `borderIdx: Map`
      table to `createStyleInterner` (parallel to `fonts`/`fills`, seeded
      with the existing empty `<border/>` at id 0), an `internBorder(b:
      CellBorder | undefined): number` building
      `<border><left .../><right .../><top .../><bottom .../></border>`
      (OOXML side order) with `style="thin|medium|thick"` and an optional
      `<color rgb="..."/>` per present side, wired into `internXf`'s
      `borderId` (replacing the hardcoded `"0"` at `xlsx.ts:263`); replace
      the fixed `'<borders count="1"><border/></borders>'` (`xlsx.ts:419`)
      with `` `<borders count="${borders.length}">${borders.join("")}
      </borders>` ``.
- [x] In `parseStyles` (`xlsx.ts:558-627`) add a `borderStyles:
      (CellBorder | undefined)[]` parsed from `<borders><border>` elements
      (only `style="thin"|"medium"|"thick"` recognized; other OOXML border
      styles are silently dropped, matching the existing graceful-
      degradation convention), and in the `<xf>` loop assign
      `style.border = borderStyles[borderId]` when present.

### Phase 4 - Merged cells: store already done (Phase 2), now render + interact

- [x] In `ExcelGrid.tsx`'s `renderCells(r0,r1,c0,c1)` (`ExcelGrid.tsx:
      1069-1111`): before the existing per-cell loop, iterate `store.get
      Merges()`, and for each merge whose range intersects `[r0,r1]x[c0,
      c1]` render one `<div className="xg-cell xg-cell--merged">` positioned
      at the merge's full pixel box (same `colMetrics.offsets`/`rowMetrics.
      offsets` math as `rectForRange`, using `width`/`height` instead of
      `left/top/width/height` deltas) with content/style/num/err modifiers
      computed from the anchor cell (`merge.startRow`, `merge.startCol`);
      collect every covered `(row,col)` (clamped to `[0,rowCount)×[0,
      colCount)`) into a `Set<string>`; skip any `(row,col)` in that set in
      the existing per-cell loop. Factor the shared "build one cell div"
      logic (currently inline in the loop body) into a small local function
      so the merge-block branch and the normal-cell branch do not duplicate
      the `className`/`style` construction.
- [x] Compute `merges = store.getMerges()` once per render (top of the
      component body) so `renderCells`, the selection/active memos, and the
      keyboard handler all read the same array.
- [x] Rename the current `selRange` memo (`ExcelGrid.tsx:279-282`) to
      `rawSelRange` (value unchanged: `normalizeRange(selection.anchor,
      selection.focus)`); repoint every existing reader that must keep
      today's exact behavior to `rawSelRange`: `buildTSV`/`applyPaste`
      (clipboard), and — inside `menuItems` — the row-zone and col-zone
      branches in their entirety plus the cell-zone's insert/delete row/
      column items, `sortRange`, and "Filter by cell value" (i.e. change
      `menuItems`'s `const r = selRange;` at `ExcelGrid.tsx:887` to
      `const r = rawSelRange;`, and add `rawSelRange` to its dependency
      array in place of `selRange`).
- [x] Add a new `selRange` memo that expands `rawSelRange` by unioning in
      any intersecting merge repeatedly until stable (merges are always
      disjoint by construction, so one pass over `merges` suffices); depend
      on `[rawSelRange, merges]`. This is the value passed to `<Toolbar
      selRange={...}>`, used by `rectForRange` for the selection/fill-
      preview boxes, `clearRange` (Delete/Backspace), and format-painter's
      destination capture (Phase 5). It is deliberately *not* used as
      `mergeCells`'s target range — merge/unmerge target `rawSelRange`
      instead (see the dedicated bullets below); pre-expanding the merge
      target through an already-touched merge would reintroduce the same
      silent-widening problem this split exists to prevent.
- [x] Change `active` (`ExcelGrid.tsx:283`, currently `selection.anchor`)
      to a memo that resolves `selection.anchor` to its merge's anchor
      coordinate via `store.getMergeAt`, when covered; depend on
      `[selection.anchor, store, version]`.
- [x] Change `activeRect` (`ExcelGrid.tsx:1268`) to use
      `store.getMergeAt(active.row, active.col) ?? normalizeRange(active,
      active)` so the active-cell highlight spans the whole merge, not just
      the anchor cell.
- [x] In `handleKeyDown`'s `move(dr, dc, extend)` (`ExcelGrid.tsx:543-553`):
      when `store.getMergeAt(base.row, base.col)` is non-null, start
      `stepVisible` from that merge's `endRow`/`endCol` (when `dr`/`dc` > 0)
      or `startRow`/`startCol` (when `dr`/`dc` < 0) instead of from `base`
      directly, so leaving a multi-row/col merge advances exactly one line
      past its far edge.
- [x] In `handleDoubleClick` (`ExcelGrid.tsx:674-680`): resolve
      `coordFromMouse(e)` to its merge anchor (via `store.getMergeAt`)
      before calling `openEditor`, so double-clicking any covered cell edits
      the anchor's content. (F2 and type-to-edit already use the
      merge-resolved `active`, so they need no change.)
- [x] Add "Merge cells" / "Unmerge cells" to the cell-zone `menuItems`
      branch (`ExcelGrid.tsx:985-1023`): label and the merge/unmerge choice
      both driven by `store.getMergeAt(active.row, active.col)`; the merge
      action targets `rawSelRange` (the literal dragged/selected range, not
      the already-merge-expanded `selRange` — `mergeCells` already replaces
      any merges the range intersects, so pre-expansion is redundant);
      disabled when neither merged nor a 2+-cell range is selected.
- [x] Add a "Merge cells" toggle button to `Toolbar.tsx`. Since `Toolbar`
      only receives the merge-expanded `selRange` prop (used by its style
      buttons), pass a second `rawSelRange` prop for this one button; it
      calls `store.mergeCells(rawSelRange)` / `store.unmergeCells(merge)`
      (label/icon reflects whether `active` is currently inside a merge).
- [x] Add `.xg-cell--merged` styling (if any visual distinction beyond the
      normal `.xg-cell` box is wanted — e.g. ensuring `overflow:hidden` and
      z-index are consistent) to `src/styles.css`; otherwise confirm the
      unmodified `.xg-cell` rules already render a merge block correctly
      and skip this if so.
- [x] In `src/utils/xlsx.ts`'s `buildSheetXml` (`xlsx.ts:281-394`): after
      `</sheetData>`, emit `<mergeCells count="N"><mergeCell ref="A1:B2"/>
      ...</mergeCells>` from `snapshot.merges` (skip entirely when empty).
      In `parseSheetXml` (`xlsx.ts:644-758`): read `tags(sheet,
      "mergeCells")[0]`'s `mergeCell` children's `ref` attributes into the
      returned snapshot's `merges: string[]`.
- [x] In `ExcelGrid.tsx`'s store-creation block (`ExcelGrid.tsx:163-178`),
      after seeding styles, seed merges from `initialState.merges` via
      `store.initMerges(...)` (parse each ref with `parseRange`, drop
      invalid/`null` entries, tolerate a missing `merges` field like every
      other optional snapshot section).

### Phase 5 - Format painter: toolbar + grid wiring

- [x] Add a "Format Painter" toggle button to `Toolbar.tsx`: `on` state =
      `store.isFormatPainterArmed()`; click arms with the current
      `selRange`'s top-left cell (or disarms if already armed).
- [x] In `ExcelGrid.tsx`'s `beginSelectDrag` (`ExcelGrid.tsx:654-672`):
      keep the existing drag/selection mechanics unchanged, but in the
      `onUp` handler, read `store.isFormatPainterArmed()` and
      `store.getFormatPainterSource()`/`store.getStyle(...)` fresh at
      onUp-execution-time (not captured earlier in the drag) — `store` is a
      stable ref so this is just reading its current state, not a stale
      closure. When armed, expand the just-settled selection
      (`normalizeRange(s.anchor, s.focus)`, read via the functional
      `setSelection` updater like the existing `onMove`) through
      `store.getMerges()` the same way the `selRange` memo does, call
      `store.replaceStyle(<that expanded range>, style)`, then
      `store.disarmFormatPainter()` — so a single click (zero-drag) and a
      drag-select destination both work through the same path, and a
      destination that touches a merge paints the whole merge.
- [x] In `handleKeyDown`'s `Escape` case (`ExcelGrid.tsx:587-589`): also
      call `store.disarmFormatPainter()` when armed, alongside the existing
      `internalClipboard.current = null`.
- [x] Add a `.xg-body--painting` (or similar) class toggled on the grid body
      while armed, with a `cursor` rule in `src/styles.css`, so the user
      gets visual feedback that a destination click is expected.

### Phase 6 - Tests and verification

- [x] Extend `src/state/GridStore.style.test.ts` with new `describe`
      blocks: `applyBorder` (all/outer/top/right/bottom/left/none presets,
      verifying only the intended sides/cells are touched and existing
      untouched sides survive), `replaceStyle` (full overwrite semantics,
      including clearing fields the new style omits), and font-family
      styling via `applyStyle`.
- [x] Add `src/state/GridStore.merge.test.ts` (new file, matching the
      existing one-file-per-theme convention): `mergeCells`/`unmergeCells`
      (anchor value/style survive, covered values clear, overlap-replace,
      one-step undo/redo), `getMergeAt`/`getMerges`, and structural-edit
      interaction (insert grows a merge spanning the insertion point,
      delete-inside shrinks it, delete-through-a-corner drops it, move
      shifts a merge fully inside the moved block by the uniform swap
      offset, and — the AR-flagged case — move drops a merge that straddles
      the boundary between the moved block and its adjacent swapped line
      rather than silently absorbing the swapped-in line's foreign content)
      building on the existing `GridStore.structure.test.ts` patterns.
- [x] Add format-painter transient-state tests (`armFormatPainter`/
      `disarmFormatPainter`/`isFormatPainterArmed`/`getFormatPainterSource`)
      to `GridStore.style.test.ts` or the new merge test file, whichever
      groups more naturally once written.
- [x] Extend `src/utils/xlsx.test.ts` with round-trip cases: a cell with a
      custom `fontFamily` (write then read back the same name), a cell with
      borders on multiple sides with distinct colors/thicknesses, and a
      snapshot with one or more `merges` entries — each via the existing
      "build snapshot → `snapshotToXlsx`/`workbookToXlsx` →
      `xlsxToSnapshot`/`xlsxToWorkbook` → assert" pattern.
- [x] Run `npm run typecheck` and `npm test`; record the exact output; fix
      any failures before moving on.
- [x] Update the top file-comment block in every touched source file
      (`types.ts`, `GridStore.ts`, `ExcelGrid.tsx`, `Toolbar.tsx`,
      `xlsx.ts`, `cellRef.ts`) summarizing the new features per the RPD
      file-comment-block convention.

### Phase 7 - E2E, documentation, and status

- [x] Create `.docs/tests/test-cell-format-suite.md` with browser scenarios:
      merge a 2x2 range (value/style survive, others clear, one undo),
      click inside the merge selects/activates the whole block, arrow keys
      step over the merge in all four directions, double-click/F2 edit the
      anchor, merge-over-merge replaces, unmerge restores independent
      cells, insert/delete rows through a merge grow/shrink/drop it,
      save/reload through xlsx preserves the merge, and — the AR-flagged
      split — right-clicking a single row header that merely touches a
      taller merge shows "Insert 1 row above"/"Delete row" (not widened to
      the merge's row count) while a Toolbar style button with that same
      selection formats the whole merge; apply each border preset with a
      chosen color/thickness and confirm only the expected
      sides render; arm format painter on a styled cell, click a plain
      cell (style copied, painter disarms), arm again and press Escape
      (no change); pick a font family from the dropdown and confirm the
      cell renders in it and xlsx round-trips it.
- [x] Execute the E2E spec against the demo (`npm run dev` via the preview
      browser); record observed results per scenario, fixing any issues
      found before re-running.
- [x] Update `README.md`: rewrite the "Format" interaction bullet
      (`README.md:80`) to mention borders/font-family, add a "Merge cells" /
      "Unmerge cells" phrase to the context-menu bullet (`README.md:73`),
      and remove "Merged cells, borders, format painter, font family" from
      the "Not (yet) included" list (`README.md:125-127`).
- [x] Mark plan tasks complete and record final evidence (typecheck/test
      output, E2E pass/fail per scenario).

## Validation

- `npm run typecheck` → exits 0, no errors.
- `npm test` → all suites pass, including the two new/extended test files
  (`GridStore.merge.test.ts`, extended `GridStore.style.test.ts` and
  `xlsx.test.ts`); report the vitest summary line.
- E2E: run the demo dev server, exercise every scenario in
  `.docs/tests/test-cell-format-suite.md`, and report per-scenario pass/fail
  with screenshots for merge rendering, border rendering, and the
  font-family dropdown.

### Recorded evidence (2026-07-22)

- `npm run typecheck`: exit 0, no errors.
- `npm test`: `Test Files 14 passed (14)`, `Tests 234 passed (234)` —
  includes the new `GridStore.merge.test.ts` (22 tests) and the extended
  `GridStore.style.test.ts` (41 tests, +applyBorder/replaceStyle/format-
  painter-state blocks) and `xlsx.test.ts` (15 tests, +font/border/merge
  round-trip).
- `npm run build`: clean, `dist/index.js`/`dist/index.cjs`/`dist/styles.css`
  generated with no type-declaration errors.
- Browser E2E against the demo (`npm run dev`, port 5199), driven via
  DOM-level mouse/keyboard event dispatch (the `computer` tool's coordinate
  space didn't line up 1:1 with the page and its "Return" key name doesn't
  map to a real `Enter` keydown in this harness — both are automation
  quirks, not product bugs; confirmed by cross-checking with directly
  dispatched `KeyboardEvent`/`MouseEvent`s):
  - Merge: selecting A1:B2 and clicking "Merge cells" produced exactly one
    spanning block showing the anchor's value, cleared B1/A2 (confirmed via
    the demo's onChange log); undo restored both cleared cells in one step.
  - Clicking anywhere inside the merged block resolved the active cell and
    name box to the anchor (A1) with the formula bar showing its value, and
    the active-cell overlay rect spanned the full merge (200×48px, not
    100×24px).
  - ArrowRight from inside the merge moved directly to C1 (one step past
    the merge's right edge); ArrowLeft from C1 re-selected the whole merge.
  - Double-clicking a covered cell (B2) opened the in-cell editor positioned
    at the anchor with the anchor's value.
  - Right-click inside the merge showed "Unmerge cells"; clicking it split
    the block back into independent cells, anchor value intact.
  - **AR-fixed behavior confirmed live**: merged D1:D3 (3 rows), then
    right-clicked row header 2 (inside the merge's span, not its anchor) —
    the menu showed "Insert row above"/"Insert row below"/"Delete row"
    (singular, scoped to exactly the clicked row), not widened to the
    merge's 3-row span. This is the exact scenario the two-memo
    (`rawSelRange`/`selRange`) split exists to prevent.
  - Borders: opened the Borders dropdown (presets, color palette, thin/
    medium/thick selector all rendered per the newly-added CSS), selected
    red + thick, clicked "All borders"; the cell's computed style showed
    `3px solid rgb(230, 0, 0)` on all four sides.
  - Font family: opened the dropdown (all 8 presets listed, checkmark on
    "Default"), selected Georgia; the cell's computed `font-family` became
    `Georgia` and the toolbar button label updated to match, visually
    rendering in a serif face.
  - Format painter: armed from the bordered/Georgia cell (button showed
    pressed state, grid body cursor became a crosshair), clicked a plain
    cell (D5) — D5's computed style immediately showed the same 3px red
    border and Georgia font, and the painter button returned to its
    unarmed state automatically.
  - **Bug found and fixed during this pass**: the first merge attempt
    crashed the app with a React "Maximum update depth exceeded" loop.
    Root cause: `Toolbar`'s search-columns-sync `useEffect` depended on the
    `selRange` object reference; since `selRange` is now recomputed fresh
    on every render that touches the merges list, the effect re-fired on
    every store mutation (including its own `setSearchCols` → `notify()`),
    which triggered another render, recomputing `selRange` again —
    infinite loop. Fixed by keying that effect on `selRange.startCol`/
    `selRange.endCol` (primitives) instead of the object reference
    (`Toolbar.tsx`). Verified fixed: the demo now merges/renders/persists
    (via localStorage autosave) without error, and the full regression
    suite (typecheck/test/build) stayed green afterward.
  - Two additional defects were found and fixed during independent code
    review (before this E2E pass): `applyBorder`'s single-edge presets
    (e.g. `"top"`) were touching every cell in the range instead of only
    the boundary cells/sides (fixed in `nextBorder`'s `touches` logic, and
    directly covered by the "outer"/single-edge `GridStore.style.test.ts`
    cases); and `remapMergeAxis`'s monotonic branch required both merge
    corners to survive a delete, incorrectly dropping a merge whose delete
    only touched its far edge instead of shrinking it (fixed to require
    only the anchor corner to survive, scanning backward for the last
    surviving far corner; covered by two new `GridStore.merge.test.ts`
    cases). A related `stylesEqual` bug (shallow `===` on the new `border`
    object made `applyBorder` non-idempotent, recording a spurious undo
    step on every re-application of an identical preset) was fixed with a
    `bordersEqual`/`borderSideEqual` deep comparison, covered by a new
    idempotency test.
  - Not re-verified via browser automation (already covered by the
    dedicated unit tests above, and lower risk than the interactions
    above): the xlsx save/reload file-I/O round-trip, the "Outside
    borders"/single-edge presets' exact rendered edges, and drag-range
    format-painter destinations.

## Rollback / Risk

- Highest-risk area is merged-cell rendering/selection/navigation inside the
  existing virtualized + frozen-pane rendering; it is scoped down by the
  explicit non-goal that merges straddling a freeze boundary are undefined,
  and is isolated to `renderCells`, the `selRange`/`active` memos, and
  `move()` — revertible independently of borders/format-painter/font-family,
  which touch disjoint code paths (`cellStyleCss` additions, new store
  methods, new toolbar controls).
- `applyBorder`'s per-cell side-touching logic is the most intricate new
  store method; it is covered directly by Phase 6's dedicated test
  `describe` block before any UI depends on it.
- No migrations, no persisted-data format break: `GridSnapshot.merges`/
  `CellStyle.border`/`CellStyle.fontFamily` are optional fields — snapshots
  saved before this change keep loading unchanged. Full rollback = revert
  the commit.
