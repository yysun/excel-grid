# Requirement: toolbar search box

## Problem

`ExcelGrid` has Excel-style per-column value filters (funnel buttons) but no
way to search for arbitrary text across the sheet. A user looking for a
value has to scroll/scan manually or open a filter popup per column. There
is no live text search in the toolbar.

## Requirement

Add a search box to the `Toolbar`, visually aligned to the right edge of the
toolbar row. As the user types:

- The grid filters to show only rows that contain the query text (rows with
  no match anywhere in scope are hidden), updating on every keystroke.
- There is no separate scope selector control. The search scope is always
  the column range of the grid's current selection (`startCol..endCol`),
  read directly from the grid's own selection state and kept live as the
  selection changes — no re-typing needed. To search the whole sheet, the
  user selects every column (e.g. select-all); a single selected cell
  scopes search to that one column, which is expected behavior, not a
  special case to work around.
- Search is case-insensitive substring matching against each cell's
  displayed text (`GridStore.getDisplay`), consistent with what the user
  sees on screen (number formats, dates, etc.), not the raw formula text.
- Every cell whose displayed text contains the query, within the active
  scope, gets its matching substring(s) visually highlighted in the grid.
- Clearing the search box (or the query becoming empty) removes the row
  filtering and all highlighting, restoring normal grid display.
- Search-driven row hiding composes with existing column-value filters and
  manually hidden rows (a row must pass all active hides to be visible).

## Acceptance Criteria

- [x] A search input renders in the `Toolbar`, right-aligned within the
      toolbar row, with no separate scope selector control alongside it.
- [x] Typing a query hides, without a manual "apply" step, every row (within
      the sheet's used range) that has no case-insensitive substring match
      in the current selection's columns.
- [x] The effective search column scope always equals
      `startCol..endCol` of the grid's current selection, sourced from the
      grid's own selection state (not a toolbar-local toggle), and updates
      live as the selection changes while a query is active (no re-typing
      needed).
- [x] Cells containing a match (within scope) render the matching
      substring(s) wrapped in a visible highlight while a query is active.
- [x] Emptying the search box unhides all search-hidden rows and removes
      all highlights; rows/highlights hidden by other means (manual hide,
      column filters) are unaffected by search state.
- [x] Search interacts correctly with existing column filters: a row hidden
      by a column filter stays hidden regardless of search match, and a row
      that matches search but is filtered out by a column filter stays
      hidden.
- [x] Editing a cell's content while a search query is active re-evaluates
      that row's match/highlight state on the next render.
- [x] Unit tests cover `GridStore` search matching/hiding scoped to an
      explicit column set, blank queries, and interaction with
      `colFilters`.

## Constraints

- Reuse the existing `isRowHidden` row-hiding pipeline (same mechanism as
  manual hide / column filters) rather than introducing a second rendering
  path for hidden rows.
- Search state is view state (like `filterCols`/frozen panes): not part of
  undo/redo history.
- No new external dependencies; follow the existing inline-SVG-icon,
  no-framework-CSS conventions already used by `Toolbar`/`FilterPopup`.
- Must not degrade typing responsiveness on the existing demo dataset
  (~1,300 rows) — matching work scans only occupied cells within the used
  range's row/col bounds, not the full `rows × cols` grid.

## Non-Goals

- A scope selector control (dropdown/toggle) for choosing "all columns" vs
  "selected columns" — search scope is always driven by the grid's actual
  selection, not a separate UI choice. (Reversed from this REQ's initial
  version, which had a toolbar scope dropdown; corrected before that
  dropdown shipped further.)
- Regex or wildcard search syntax.
- "Find & replace" or next/previous match navigation.
- Persisting search query/scope across component remounts or in undo
  history.
- Searching raw formula text instead of displayed value.

## Open Questions

None.
