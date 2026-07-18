# REQ: Context menus for rows, columns, and cells

Story: `context-menus` — created 2026-07-18.

## Problem

The grid supports editing, formulas, clipboard, and formatting, but every
structural or organizational operation a spreadsheet user expects from
right-click — inserting/deleting rows and columns, hiding, freezing, sorting,
filtering — is missing entirely. Users coming from Excel/Google Sheets/WeCom
docs right-click a row header and get the browser's default menu instead of
spreadsheet actions, making the component unusable for real table maintenance.

## Requirement

Right-clicking inside the grid shall open a context-appropriate custom menu
(suppressing the browser menu) with working actions:

1. **Row header menu** (right-click a row number):
   - Cut, Copy, Paste
   - Insert N row(s) above, Insert N row(s) below (N = number of selected rows)
   - Delete row(s)
   - Move row(s) up, Move row(s) down
   - Hide row(s), Unhide rows (unhides hidden rows inside the selection)
   - Freeze up to this row, Unfreeze rows
2. **Column header menu** (right-click a column letter): the column
   equivalents of everything above, plus:
   - Sort sheet A→Z / Z→A by that column (reorders the rows of the used data
     region keyed on that column)
3. **Cell menu** (right-click a body cell):
   - Cut, Copy, Paste
   - Insert row above / Insert column left, Delete row(s) / Delete column(s)
     covering the selected range
   - Sort range A→Z / Z→A (reorders the selected range's rows keyed on the
     range's first column)
   - Filter by cell value (hides used-range rows whose value in that column
     differs from the active cell's value), Clear filter

Semantics that must hold:

- Right-clicking a cell/header **outside** the current selection first moves
  the selection there (header click selects the full row/column); right-click
  **inside** the selection preserves it. The menu then acts on the selection.
- Insert shifts existing cells (with their styles) down/right; sheet
  dimensions stay fixed, so content shifted past the last row/column is
  dropped. Delete removes the selected rows/columns and shifts the remainder
  back. Move swaps the selected block to the adjacent position.
- Formula references anywhere in the sheet are rewritten across insert,
  delete, and move: references to shifted cells follow them; references to
  deleted cells become `#REF!`.
- Insert, delete, move, and sort are undoable through the existing
  undo/redo stack as single actions.
- Hidden rows/columns render with zero size (headers and cells disappear);
  arrow-key navigation skips them; unhide restores them.
- Frozen rows/columns stay pinned at the top/left while the body scrolls.
- Cut/Copy from the menu populate the clipboard exactly like Ctrl+C/X; Paste
  uses the async clipboard API with the internal clipboard as fallback.
- Sort orders numbers numerically, text case-insensitively after numbers,
  blanks always last; descending reverses non-blank order only.
- The menu closes on action, Escape, click-away, or scroll, and is
  repositioned to stay fully inside the viewport.

## Acceptance Criteria

- [x] Right-click on a row header, column header, and body cell each opens a
      menu with the item set listed above; the native browser menu is
      suppressed; menu closes on Escape, outside click, and item activation.
- [x] Right-click outside the selection re-targets it (full row/col for
      headers, single cell for cells); inside the selection preserves it.
- [x] Insert rows/columns shifts raw content and styles, drops overflow at
      the sheet edge, and rewrites formula references sheet-wide.
- [x] Delete rows/columns removes content, shifts the remainder, rewrites
      references, and turns references to deleted cells into `#REF!`.
- [x] Move rows/columns relocates the selected block by one position with
      content and styles; references pointing into the moved block follow it.
- [x] Insert, delete, move, and sort each undo/redo as one action restoring
      the exact prior sheet (content and styles).
- [x] Hide removes the rows/cols from view (zero height/width, headers gone);
      Unhide on a selection spanning them restores them; arrow navigation
      skips hidden indices.
- [x] Freeze up to row N / column N keeps those rows/cols visible while
      scrolling the body; Unfreeze releases them; frozen cells remain
      clickable and selectable.
- [x] Menu Cut/Copy/Paste round-trip cell content identically to the
      keyboard shortcuts, including cut-source clearing on paste.
- [x] Column-header sort reorders used-range rows by that column; cell-menu
      sort reorders only the selected range's rows by its first column;
      ordering follows the comparator rules above.
- [x] Filter by cell value hides non-matching used-range rows; Clear filter
      restores them; Clear filter is disabled when no filter is active.
- [x] All existing unit tests still pass; new store-level tests cover
      insert/delete/move/hide/sort/filter and formula rewriting.

## Constraints

- No new runtime dependencies; menu is a custom component styled like the
  existing `.xg-` UI, namespaced `.xg-menu*`.
- Sheet dimensions (`rows`/`cols` props) remain fixed; structural operations
  remap content within them.
- Structural undo may snapshot sparse sheet state (occupied cells/styles
  only); memory cost is bounded by occupied-cell count.
- Virtualization must keep working: hidden rows/cols and frozen panes must
  not force rendering the whole sheet.
- Public API surface may grow (store methods), but existing `ExcelGridProps`
  and `ExcelGridHandle` contracts must not break.

## Non-Goals

- Full Excel autofilter UI (dropdown checklists, multi-condition filters) —
  only filter-by-value and clear.
- Reference rewriting on **sort** (raw text moves as-is) and range-shrinking
  on delete (a deleted range endpoint becomes `#REF!` rather than shrinking).
- Moving styles during sort (sort moves raw content only).
- Undo for view-only state: hide/unhide, freeze/unfreeze, and filters are not
  on the undo stack (consistent with column widths today).
- Drag-to-move rows/columns, multi-step "move to arbitrary index" UI,
  insert-cut-cells paste mode.
- Row height resizing; rows stay uniform height except hidden (zero).
- Persisting hidden/frozen state through the imperative handle.
