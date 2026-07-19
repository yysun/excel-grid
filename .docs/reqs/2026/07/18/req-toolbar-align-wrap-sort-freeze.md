# REQ: Toolbar buttons — vertical alignment, text wrapping, sort, filter, freeze panes

## Problem

The WeCom-style toolbar covers text formatting, colors, number formats, and
horizontal alignment, but common spreadsheet operations — vertical alignment,
text wrapping, sorting, filtering, and freezing panes — are only reachable
through right-click context menus (sort/filter/freeze) or not available at all
(vertical alignment, wrapping). Users expect one-click access to these from
the toolbar, as in Excel Web and WeCom sheets.

## Requirement

Extend the toolbar with the following controls, all operating on the current
selection / active cell and consistent with existing toolbar behavior
(English tooltips, pressed states from the active cell, focus kept on the
grid):

1. **Vertical alignment**: three toggle buttons (top / middle / bottom) that
   set a per-cell vertical alignment style on the selection. Clicking the
   currently-active alignment clears it back to default. Cell rendering must
   honor the style.
2. **Text wrapping**: one toggle button that turns word wrapping on/off for
   the selection. Wrapped cells render multi-line within the current row
   height (clipped if too tall). Pressed state reflects the active cell.
3. **Sorting**: ascending and descending buttons.
   - Multi-cell selection: sort the selected range by its first column.
   - Single-cell selection: sort the sheet's used range by the active cell's
     column (same behavior as the column-header context menu).
4. **Filtering**: a filter toggle button.
   - No filter active: filter rows by the active cell's value in its column
     (same as the context menu's "Filter by value").
   - Filter active: clear the filter. Button shows a pressed state while a
     filter is active.
5. **Freeze panes**: a button opening a popover with:
   - Freeze rows up to the selection's end row.
   - Freeze columns up to the selection's end column.
   - Unfreeze all (disabled when nothing is frozen).
   Button shows a pressed state while any rows or columns are frozen.

Vertical alignment and wrap must participate in the existing style layer:
undoable, cleared by "Clear formatting", persisted per cell
independent of value.

## Acceptance Criteria

- [x] `CellStyle` supports vertical alignment (`top | middle | bottom`) and
      `wrap`, exported from the library types.
- [x] Toolbar shows top/middle/bottom vertical-align buttons; clicking applies
      to the selection, re-clicking the active one resets to default, and the
      grid cell rendering visibly changes vertical position.
- [x] Toolbar shows a wrap toggle; wrapped cell text renders on multiple lines
      within the row height; pressed state follows the active cell's style.
- [x] Vertical alignment and wrap are undoable via undo/redo and removed by
      the clear-format button.
- [x] Toolbar sort-ascending / sort-descending buttons sort the selection by
      its first column (multi-cell) or the used range by the active column
      (single cell), matching existing `sortRange` semantics.
- [x] Toolbar filter button applies a value filter from the active cell when
      no filter is active, clears the filter when one is active, and shows a
      pressed state while filtering.
- [x] Toolbar freeze button opens a popover offering freeze-rows-to-selection,
      freeze-cols-to-selection, and unfreeze; frozen panes render accordingly
      and the button shows a pressed state while frozen.
- [x] Unit tests cover the new style keys (apply/merge/undo/clear-format).
- [x] Existing tests, typecheck, and build still pass.

## Constraints

- Follow existing toolbar conventions: English tooltips, inline SVG icons,
  no external dependencies, `mousedown` prevented to keep grid focus,
  popovers close on outside mousedown.
- Sorting/filter/freeze must reuse the existing `GridStore` APIs
  (`sortRange`, `filterByValue`, `clearFilter`, `setFrozenRows`,
  `setFrozenCols`) — no parallel implementations.
- Style changes must respect `STYLE_CELL_CAP` (inherited from `applyStyle`).
- No breaking changes to the public component props or exported types.

## Non-Goals

- Auto row-height growth for wrapped text (rows keep their height; overflow
  is clipped).
- Multi-column / custom sort keys, sort dialogs, or header filter dropdowns.
- Filter criteria UI beyond the existing filter-by-active-cell-value.
- Freeze at arbitrary positions beyond the selection-based options above.
- Feature flags or props to hide individual toolbar buttons.
