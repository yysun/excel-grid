# REQ: wecom-toolbar — WeCom-style minimal toolbar for ExcelGrid

## Problem

The `excel-grid` component renders values and formulas but offers no
visible UI for common spreadsheet actions (undo/redo, formatting, number
formats, alignment, quick sum). Users coming from 企业微信表格 (WeChat Work
spreadsheet) expect a compact, flat toolbar above the formula bar. Today the
grid also has no cell-formatting model at all, so even keyboard power users
cannot bold a header row or format a column as percent.

## Requirement

Add a WeCom-style minimal ("简约") toolbar component that sits above the
formula bar and operates on the grid's current selection:

1. **Toolbar component** (`Toolbar`, internal; enabled through a new
   `ExcelGridProps.toolbar?: boolean` prop, default `true`) rendered inside
   `ExcelGrid`, styled after the 企业微信表格 toolbar: flat icon buttons
   (~28px), thin separators, light hover state, blue active/toggled state,
   Chinese tooltips (`title` attributes).
2. **Toolbar controls**, left to right:
   - 撤销 / 重做 (undo / redo) — disabled when the corresponding stack is empty.
   - 清除格式 (clear format) — removes all styling from the selected range.
   - 数字格式: 常规 dropdown is out of scope; instead the three compact
     controls from the reference: `%` (percent), `,` (thousands separator),
     and 增加/减少小数位 (increase / decrease decimals).
   - 字号 (font size) dropdown: 10 / 11 / 12 / 14 / 16 / 18 / 24.
   - **B** / *I* / U̲ / ~~S~~ toggle buttons (bold, italic, underline,
     strikethrough).
   - 文字颜色 (text color) and 填充颜色 (fill color) palette dropdowns with a
     small fixed palette plus "Automatic" (reset).
   - 对齐 (horizontal alignment): left / center / right toggle group.
   - Σ 求和 (quick sum): writes `=SUM(...)` for each selected column in the
     row below the selection.
3. **Cell style model** in `GridStore` so the toolbar actions actually change
   the sheet: per-cell style record (bold, italic, underline, strike,
   fontSize, color, background, align, numFmt: general/percent/thousands,
   decimals), stored sparsely and independent of cell values (an empty cell
   can carry a fill color).
4. **Undoable styling**: every toolbar style action is one undo step,
   integrated with the existing undo/redo stacks (Ctrl+Z reverts a bold the
   same way it reverts an edit).
5. **Rendering**: cells render their style (font weight/style/decoration,
   size, color, background, text alignment) and number-formatted display
   values (percent, thousands separators, fixed decimals) without breaking
   virtualization.
6. **Toggle feedback**: B/I/U/S, alignment, and number-format buttons reflect
   the active cell's current style (pressed state).

## Acceptance Criteria

- [ ] `ExcelGrid` shows the toolbar by default; `toolbar={false}` hides it.
- [ ] Undo/redo buttons trigger `store.undo()/redo()` and are disabled when
      `canUndo()/canRedo()` is false.
- [ ] Selecting a range and clicking **B** bolds every cell in the range;
      clicking again (when the active cell is bold) un-bolds the range.
- [ ] Italic, underline, strikethrough behave the same way.
- [ ] Text color / fill color palettes apply the chosen color to the selected
      range; "Automatic" clears that color.
- [ ] Font size dropdown applies the size to the selected range and shows the
      active cell's size.
- [ ] Alignment buttons set left/center/right on the range; numbers keep
      right-alignment only when no explicit alignment is set.
- [ ] `%` formats numeric cells as percent (`0.5` → `50%`), `,` as thousands
      (`1234567` → `1,234,567`), and the decimal buttons adjust displayed
      decimal places; raw values and formula results are unchanged.
- [ ] 清除格式 removes all style from the selected range in one undo step.
- [ ] Σ writes `=SUM(<col-range>)` below the selection for each selected
      column and the formula evaluates.
- [ ] Every style action is undoable/redoable via toolbar buttons and
      Ctrl/Cmd+Z / Ctrl/Cmd+Y.
- [ ] Styles render in the virtualized grid (scroll away and back — style
      persists) and `npm run test` / `npm run typecheck` / `npm run build`
      pass.

## Constraints

- Keep the library dependency-free (no icon package — inline SVG or text
  glyphs only); styles namespaced under `.xg-`.
- Style application iterates the selected range directly; whole-sheet
  selections on the default 1000×26 grid (~26k cells) must stay responsive.
  Cap style application at 200,000 cells per action (no-op beyond, matching
  "简约" scope) to avoid freezing on huge custom grids.
- Public API surface change is additive: new optional prop + exported style
  types; existing consumers compile unchanged.
- Toolbar must not steal keyboard focus from the grid (mousedown-preventDefault
  pattern already used by headers).
- Tooltips/labels in Chinese to match 企业微信表格; code and docs in English.

## Non-Goals

- 菜单 (menu), 格式刷 (format painter), 插入 (insert), 字体 (font family),
  边框 (borders), 合并单元格 (merge), 行高列宽 controls, 换行 (wrap), 筛选
  (filter), 排序 (sort), 冻结 (freeze), 查找 (search), and the 常规 number
  format dropdown from the reference screenshot — visual reference only, not
  scope.
- Persisting styles through the imperative handle (`getData` stays raw+value).
- Rich text (per-character formatting), cell-level fonts, vertical alignment.
- No feature flags or fallback modes beyond the single `toolbar` prop.
