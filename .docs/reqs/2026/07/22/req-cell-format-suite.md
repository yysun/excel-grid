# REQ: Merged cells, borders, format painter, and font family

Story: `cell-format-suite` — created 2026-07-22.

## Problem

`README.md`'s "Not (yet) included" section calls out four gaps that make the
grid feel incomplete next to Excel/Google Sheets/WeCom docs: there is no way
to merge a range of cells into one, no way to draw a border on any side of a
cell, no way to copy one cell's formatting onto other cells without copying
its value, and no way to change a cell's font away from the hard-coded
system font stack. All four are pure formatting/presentation features that
slot into the existing `CellStyle`-driven toolbar and store architecture used
by bold/italic/color/alignment today.

## Requirement

### 1. Merged cells

- A user can merge the current selection (2+ cells) into one merged cell via
  the toolbar and the cell right-click menu ("Merge cells" / "Unmerge
  cells").
- Merging keeps the top-left cell's value and style; the value of every
  other cell covered by the merge is cleared as part of the same undo step.
- A merged cell renders as a single visual block spanning the union of its
  rows/columns; the covered (non-anchor) cells render nothing and are not
  independently selectable, clickable, or editable.
- Clicking, arrow-navigating onto, or range-selecting into any cell covered
  by a merge acts on the merge as a whole: the active cell becomes the
  anchor, and a selection touching any part of a merge expands to cover the
  merge entirely.
- Arrow-key navigation steps over a merge as a single unit in the direction
  of travel (entering from one side lands on the near edge; leaving from the
  far edge moves past the whole block), the same way hidden rows/columns are
  already skipped.
- Editing (double-click, F2, type-to-edit, formula bar) a covered cell edits
  the anchor cell.
- Creating a merge that overlaps one or more existing merges replaces them
  with the one new merge.
- Unmerge splits the block back into individual cells; the anchor keeps its
  value and style, the previously-covered cells stay empty (no value
  restoration).
- Merge/unmerge are each one undoable action.
- Row/column insert shifts a merge like any other content; row/column delete
  that removes part of a merge's span shrinks it, and delete that removes an
  edge cell required to anchor the merge (or the whole merge) drops it
  entirely — merges never end up spanning a deleted line.
- `getSnapshot()` / `initialState` / xlsx import-export round-trip the set of
  merged ranges.

### 2. Cell borders

- A user can apply a border to the selection via a new toolbar "Borders"
  control offering: all borders, outside (outer) border, top/right/bottom/
  left border, and no border (clears existing borders), each combined with a
  chosen line color and thickness (thin/medium/thick).
- "All borders" sets every side of every cell in the range. "Outside"
  and the single-side options only touch the sides that lie on that edge of
  the range (e.g. "Top" sets the top edge of the top row only); untouched
  sides of a cell keep whatever border they already had. "No border" clears
  every side on every cell in the range.
- Borders render as visible per-side lines on the cell in the exact color
  and thickness chosen, independent of the grid's default gridlines.
- Applying a border is one undoable action.
- `getSnapshot()` / `initialState` / xlsx import-export round-trip border
  sides, color, and thickness per cell.

### 3. Format painter

- A new toolbar toggle button ("Format Painter") arms the feature using the
  current selection as the format source; the button shows a pressed/active
  state while armed.
- While armed, clicking or drag-selecting any destination range in the grid
  body applies the source's formatting (the complete `CellStyle` — number
  format, font, colors, alignment, wrap, borders — of the source
  selection's top-left cell) to every cell of the destination range,
  replacing each destination cell's existing style outright, then disarms
  the painter automatically.
- Pressing Escape or clicking the toggle button again while armed disarms
  the painter without changing any cell.
- Applying the painted format is one undoable action.

### 4. Font family

- A new toolbar font-family dropdown (next to the existing font-size
  dropdown) lists a fixed set of common cross-platform font choices and
  shows the active cell's current font (default label when unset).
- Selecting a font applies it to every cell in the current selection as one
  undoable action; cells render in the chosen font.
- `getSnapshot()` / `initialState` / xlsx import-export round-trip the font
  family per cell.

## Acceptance Criteria

- [x] Selecting 2+ cells and choosing "Merge cells" (toolbar or right-click)
      merges them into one block; the top-left cell's value/style survive,
      other covered cells' values are cleared; this is one undo step.
      Evidence: `GridStore.merge.test.ts` ("mergeCells" describe block);
      live E2E in the demo (A1:B2 merge, B1/A2 cleared, one-step undo).
- [x] A merged cell renders as a single spanning box; covered cells render
      empty and are not independently clickable, and clicking anywhere in
      the merged area selects/activates the anchor.
      Evidence: live E2E — clicking the covered B2 area resolved the name
      box/formula bar to the anchor (A1/"hello") and the active-cell
      overlay spanned the full 200×48px merge, not a single cell.
- [x] Arrow-key navigation treats a merge as one step in every direction
      (entering and leaving), matching hidden-row/column skip behavior.
      Evidence: live E2E confirmed ArrowRight (leaving) and ArrowLeft
      (entering) on the row axis; the column axis and up/down directions
      share the same `move()` far-edge-stepping code path (symmetric by
      construction, not direction-specific), not independently re-tested.
- [x] Double-click, F2, type-to-edit, and the formula bar on any covered cell
      edit the anchor cell's content.
      Evidence: live E2E for double-click (opened the editor at the anchor
      with its value). F2/type-to-edit/formula bar all read the same
      merge-resolved `active` coordinate verified correct above; not
      independently re-clicked per entry point.
- [x] Merging over an existing merge replaces it; "Unmerge cells" restores
      independent cells (anchor keeps value/style, others stay blank), one
      undo step each.
      Evidence: `GridStore.merge.test.ts` (overlap-replace, unmerge, undo/
      redo cases); live E2E unmerge via the cell context menu.
- [x] Inserting rows/columns shifts a merge with its content; deleting rows/
      columns shrinks a partially-overlapped merge or removes it entirely
      when its anchor or full span is deleted; no merge ever spans a
      deleted line after the operation.
      Evidence: `GridStore.merge.test.ts` "structural edits remap merges"
      block — insert-grows, delete-interior-shrinks, delete-far-edge-
      shrinks, delete-anchor-drops, delete-full-span-drops, move-shifts,
      move-drops-straddling, move-drops-exact-span-swap, unaffected-merge-
      unchanged, and the column-axis mirror.
- [x] A round-trip through `getSnapshot()`/`initialState` and through
      `snapshotToXlsx`/`xlsxToSnapshot` (and the workbook equivalents)
      preserves the merged-range set.
      Evidence: `xlsx.test.ts` "preserves merged ranges". The
      `initialState.merges` → `store.initMerges` wiring in `ExcelGrid.tsx`
      is a direct structural mirror of the pre-existing (also never
      component-tested) `initialState.styles` wiring — consistent with
      this project's store/util-level testing convention; not separately
      covered by a component-rendering test.
- [x] The Borders toolbar control applies all-borders, outer, one-side
      (top/right/bottom/left), and no-border presets with a chosen color and
      thickness; outer/single-side presets touch only the relevant edge
      cells and leave other sides of boundary cells untouched; each
      application is one undo step.
      Evidence: `GridStore.style.test.ts` "applyBorder" block (all 4
      presets' exact touched-cell/side sets, other-sides-preserved, one-
      step undo/redo, cap no-op) — this block caught and pinned a real
      bug (single-edge presets initially touched every cell, not just the
      boundary) found during code review. Live E2E: "All borders" with
      red/thick applied `3px solid rgb(230,0,0)` on all sides.
- [x] Bordered cells show the chosen per-side color/thickness visually,
      distinct from the grid's default gridlines.
      Evidence: live E2E computed-style check above (explicit 3px red vs.
      the grid's default 1px gray gridline).
- [x] A round-trip through `getSnapshot()`/`initialState` and through the
      xlsx helpers preserves border sides, color, and thickness per cell.
      Evidence: `xlsx.test.ts` "preserves font family and per-side
      borders" (multiple sides, distinct colors/thicknesses).
- [x] Toggling Format Painter with a selection arms it (button shows active
      state); clicking or drag-selecting a destination range then applies
      the source top-left cell's complete style to every destination cell
      (replacing prior style) and disarms the button; this is one undo
      step; Escape or a second click on the button disarms without changes.
      Evidence: `GridStore.style.test.ts` "format-painter armed state" +
      "replaceStyle" blocks (arm/disarm/full-overwrite/undo). Live E2E:
      armed from a bordered+Georgia cell (button showed pressed state,
      crosshair cursor), clicked a plain cell, destination immediately
      showed the same border+font, button auto-disarmed. Escape-disarm and
      a second-click-to-disarm are a one-line addition to the existing,
      already-tested Escape handler and toggle pattern; not independently
      re-clicked in the browser.
- [x] The font-family dropdown lists the active cell's current font (or a
      default label) and applying a choice restyles every selected cell in
      that font as one undo step; the grid visually renders the chosen font.
      Evidence: live E2E — dropdown listed all 8 presets with a checkmark
      on "Default"; selecting Georgia updated the button label, the cell's
      computed `font-family`, and its visual rendering (serif). Multi-cell
      range application and its single undo step follow the same
      `applyStyle` path already covered by existing `applyStyle` tests.
- [x] A round-trip through `getSnapshot()`/`initialState` and through the
      xlsx helpers preserves font family per cell.
      Evidence: `xlsx.test.ts` "preserves font family and per-side
      borders".
- [x] All existing unit tests still pass; new store-level tests cover merge/
      unmerge (including structural-edit interaction and undo), border
      presets, format-painter style replacement, and font-family styling;
      xlsx tests cover round-tripping merges, borders, and font family.
      Evidence: `npm test` → 14 test files, 234 tests, all passing;
      `npm run typecheck` and `npm run build` both clean.

## Constraints

- No new runtime dependencies.
- `ExcelGridProps` and `ExcelGridHandle` public contracts do not break;
  additions only (e.g. `GridSnapshot` gains fields, `CellStyle` gains
  fields).
- Virtualized rendering must keep working: merged-cell rendering must not
  force materializing the whole sheet, and must remain correct across the
  existing frozen-pane render passes for merges that do not straddle a
  freeze boundary (see Non-Goals).
- New toolbar UI follows the existing `.xg-tb-*` visual language (popovers,
  toggle buttons, dropdowns) already used by font size, colors, and the
  format-code menu.
- Border/font-family/merge state is sparse (only cells/ranges the user
  touches carry data), consistent with the existing sparse `styles` map.

## Non-Goals

- Row/column structural commands (insert/delete/move/hide/freeze/sort, via
  the row-header, column-header, and cell right-click menus) operate on
  exactly the rows/columns the user selected; they are never widened just
  because a merge happens to touch that selection. Only rendering, in-place
  clearing (Delete/Backspace), and cell-formatting actions (toolbar style
  buttons, format painter, merge/unmerge itself) expand to cover a touched
  merge's full extent.
- Diagonal cell borders, dashed/dotted/double border line styles — only
  solid thin/medium/thick.
- Non-rectangular or disjoint merge shapes; merging across a frozen-pane
  split boundary is undefined/unsupported.
- Fill-handle autofill across a range containing merged cells (undefined
  behavior) — merges interacting with drag-fill are out of scope.
- Format painter "sticky"/multi-use mode (Excel's double-click-to-lock);
  this feature is single-use per arm.
- Format painter tiling a multi-cell source pattern onto a same-shaped
  destination — it always broadcasts the source's top-left cell style.
- Format painter copying row height, column width, or merge state — style
  only.
- Custom/arbitrary font upload or per-character (rich text) fonts within one
  cell — a fixed preset list, whole-cell only, matching the existing
  bold/italic/font-size model.
- Any print/PDF-specific border rendering.
