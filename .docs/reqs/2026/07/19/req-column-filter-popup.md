# REQ: column-filter-popup

## Problem

The toolbar Filter button currently applies a one-shot "hide every row whose
value differs from the active cell" filter. There is no way to see which
columns are filtered, no way to filter by more than one value, and no way to
combine filters across columns. Users expect Excel-style AutoFilter: a
toolbar toggle that puts filter buttons on columns, each opening a popup
where multiple values can be checked.

## Requirement

- The toolbar Filter button toggles filter mode:
  - When filter mode is off, clicking it enables filter buttons on the
    columns covered by the current selection.
  - When filter mode is on (any column has a filter button), clicking it
    turns filter mode off everywhere: all filter buttons disappear and all
    active filters are cleared (hidden rows reappear).
  - The button renders pressed while filter mode is on.
- Each filter-enabled column shows a filter button in its column header
  (the lettered header strip), alongside the existing hover sort button.
- Clicking a column's filter button opens a popup anchored to that button:
  - It lists the distinct values of that column within the used range, each
    with a checkbox, sorted ascending (numbers before text, blanks last).
  - Blank cells appear as a single "(Blanks)" entry.
  - A "Select all" control checks/unchecks every value.
  - A search box narrows the visible value list (case-insensitive substring).
  - OK applies the checked set; Cancel (or clicking outside / Escape)
    closes without changing the filter.
  - Values currently allowed by the column's filter open pre-checked; a
    column with no active filter opens with everything checked.
- Applying a filter hides every used-range row whose value in that column is
  not in the checked set. Filters on multiple columns combine with AND.
- A column whose filter excludes at least one value shows its filter button
  in an active (highlighted) state, like Excel's funnel-on-filtered-column.
- Filtered-out rows re-appear when their column's filter is cleared
  (all values checked) or filter mode is toggled off.
- Filter results stay correct after cell edits: changing a cell in a
  filtered column re-evaluates row visibility.
- The context menu keeps working:
  - "Filter by cell value" enables a filter button on the active cell's
    column and applies a filter allowing only that cell's value.
  - "Clear filter" clears all column filters (buttons stay visible).
- Structural edits (insert/delete/move rows or columns) keep filter buttons
  and filters attached to the correct columns, consistent with how hidden
  columns are remapped today.

## Acceptance Criteria

- [x] Toolbar Filter click with selection covering columns B–C shows filter
      buttons on the B and C headers only; second click removes all filter
      buttons and unhides all filter-hidden rows.
- [x] Toolbar Filter button shows pressed state exactly while at least one
      column has a filter button.
- [x] Clicking a column filter button opens a popup listing that column's
      distinct used-range values with checkboxes, sorted ascending, with
      blanks shown once as "(Blanks)" at the end.
- [x] Unchecking a value and pressing OK hides exactly the used-range rows
      with that value in that column; other rows stay visible.
- [x] Filters on two different columns hide the union of rows excluded by
      each (AND semantics for visibility).
- [x] Reopening a filtered column's popup shows the previously checked set;
      "Select all" then OK restores every hidden row for that column.
- [x] The search box narrows the value list case-insensitively; OK applies
      only the checked state of values (search is a view, not a filter).
- [x] A column with an active (excluding) filter renders its filter button
      highlighted; clearing the filter removes the highlight.
- [x] Editing a cell in a filtered column immediately re-evaluates that
      row's visibility.
- [x] Context menu "Filter by cell value" filters the active column to just
      that value and shows a highlighted filter button on that column;
      "Clear filter" restores all rows.
- [x] Unit tests cover the GridStore filter model (set/clear per-column
      filters, AND combination, blank handling, re-evaluation on edit,
      column remap on insert/delete).
- [x] `npm run typecheck`, `npm run test`, and `npm run build` pass.

## Constraints

- Filter state is view state (like hidden rows/cols and freeze): not
  undoable, but remapped by structural edits so it tracks its columns.
- Values compare by computed cell value (what the formula evaluates to),
  not by styled display text; two cells with the same value but different
  number formats are one popup entry.
- Popup must not steal grid keyboard focus permanently; closing returns
  focus to the grid. Toolbar `mousedown` prevention conventions apply.
- No new dependencies; inline SVG icons and existing CSS conventions
  (`xg-` prefixed classes in `src/styles.css`).
- Virtualized headers: filter buttons must render correctly in both the
  scrolling header strip and the frozen-columns header copy.

## Non-Goals

- No header-row concept: all used-range rows are filterable data (no
  Excel-style "first row is labels" exclusion).
- No sort controls inside the filter popup (sorting stays on the existing
  header sort button).
- No text/number/date condition filters ("greater than", "contains", …) —
  value-list filtering only.
- No persistence of filter state across component unmount.
- No undo/redo integration for filter changes.
