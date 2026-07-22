# excel-grid

An Excel-style spreadsheet grid for React — cell editing, formulas with live
recalculation, keyboard navigation, clipboard interop, undo/redo, column
resize, a fill handle, and a WeCom-style formatting toolbar (bold/italic/
underline/strikethrough, text & fill colors, font size, alignment, number
formats, quick sum), in a virtualized grid that handles 10,000 × 100 cells
and beyond. No runtime dependencies besides React.

## Install

The package ships ESM + CJS bundles with TypeScript declarations. React 18+
and ReactDOM are peer dependencies.

```sh
npm install excel-grid react react-dom
```

## Usage

```tsx
import { useRef } from "react";
import { ExcelGrid, type ExcelGridHandle, type GridChange } from "excel-grid";
import "excel-grid/styles.css";

function Sheet() {
  const grid = useRef<ExcelGridHandle>(null);
  return (
    <div style={{ height: 600 }}>
      <ExcelGrid
        ref={grid}
        rows={10000}
        cols={100}
        initialCells={{ A1: "Revenue", B1: "1200", B2: "=B1*0.21", B3: "=B1-B2" }}
        onChange={(changes: GridChange[]) => console.log(changes)}
      />
    </div>
  );
}
```

The grid fills its container (give the parent a height). Styles are namespaced
under the `xg-` class prefix and must be imported once per app.

## Props

| Prop              | Type                             | Default | Description                                        |
| ----------------- | -------------------------------- | ------- | -------------------------------------------------- |
| `rows`            | `number`                         | `1000`  | Total row count                                    |
| `cols`            | `number`                         | `26`    | Total column count                                 |
| `initialCells`    | `Record<string, string>`         | —       | Initial contents keyed by A1-style ref             |
| `initialState`    | `GridSnapshot`                   | —       | Full-state snapshot applied at mount (after `initialCells`) |
| `onChange`        | `(changes: GridChange[]) => void`| —       | Fires per committed batch (edit/paste/fill/undo…)  |
| `onStateChange`   | `() => void`                     | —       | Fires on every mutation, including style- and column-width-only edits; pair with `getSnapshot()` for host-app persistence |
| `rowHeight`       | `number`                         | `24`    | Row height in px                                   |
| `defaultColWidth` | `number`                         | `100`   | Default column width in px                         |
| `className`       | `string`                         | —       | Extra class on the root element                    |
| `toolbar`         | `boolean`                        | `true`  | Show the formatting toolbar above the formula bar  |

## Ref API (`ExcelGridHandle`)

| Method                 | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `getCell(ref)`         | `{ raw, value, error? }` for an A1-style ref, or `null`            |
| `setCell(ref, raw)`    | Write a cell (undoable, recalculates dependents)                   |
| `getData()`            | All non-empty cells as `{ ref, raw, value, display }[]`            |
| `getSnapshot()`        | Full serializable grid state (`{ cells, styles, colWidths, rowHeights, merges }`), JSON-safe for persistence |

## Interactions

- **Select**: click, drag, Shift+click / Shift+arrows, row/column header click or drag (multi-row/column), Ctrl/Cmd+A.
- **Search**: the toolbar's search box live-highlights matches, scoped to the columns of the current grid selection (no separate scope control).
- **Context menus**: right-click a cell, row header, or column header. Cells: cut/copy/paste, insert/delete rows & columns, merge/unmerge cells, sort the selected range, filter by cell value, clear filter. Row/column headers: cut/copy/paste, insert/delete/move/hide/unhide lines, freeze/unfreeze panes, and (columns) sort the sheet by that column. Insert/delete/move rewrite formula references sheet-wide (references to deleted lines become `#REF!`) and undo as one step.
- **Navigate**: arrows, Tab/Shift+Tab, Enter/Shift+Enter, Home, Ctrl/Cmd+Home, PageUp/PageDown; a merged cell is skipped/stepped as one unit.
- **Edit**: double-click, F2, or just start typing; Enter/Tab commit (moving down/right), Escape cancels; Delete clears the selection; the formula bar edits the active cell. Editing any cell covered by a merge edits the merge's anchor.
- **Clipboard**: Ctrl/Cmd+C/X/V with TSV interop (pastes to/from Excel and Google Sheets). Copied formulas adjust relative references by the paste offset.
- **Undo/redo**: Ctrl/Cmd+Z, Ctrl/Cmd+Y or Shift+Ctrl/Cmd+Z.
- **Resize**: drag a column header's right edge.
- **Fill**: drag the square handle at the selection corner down or right.
- **Format**: toolbar applies bold/italic/underline/strikethrough, font size, font family, text/fill colors, borders (all/outside/single-edge/no-border presets with color + thickness), alignment, percent/thousands formats and decimal places to the selection; a format-painter toggle copies one cell's complete formatting onto a clicked/dragged destination; 清除格式 clears styling; Σ writes `=SUM(…)` below each selected column. Every action is one undo step.
- **Merge cells**: toolbar button or cell context menu merges the selection into one cell (keeping the top-left cell's value/style, clearing the others) or unmerges it; a selection touching a merge renders/selects/formats as the whole block, while row/column structural commands (insert/delete/move/hide/freeze/sort) still act on exactly the rows/columns selected.

## Formulas

Start a cell with `=`. Supported: numbers, strings (`"…"`), booleans, cell
refs (`A1`, `$A$1`), ranges (`A1:B3`), operators `+ - * / ^ % &` and
comparisons `= <> < <= > >=`, and functions:

`SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ROUND, ABS, CONCATENATE, AND, OR, NOT`

Dependents recalculate automatically. Errors follow Excel conventions:
`#NAME?`, `#VALUE!`, `#DIV/0!`, `#REF!`, and `#CYCLE!` for circular
references.

## Persistence & file import/export

The package exports helpers for host-app persistence and interop, on top of
`getSnapshot()` / `initialState`:

| Export                        | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `toCSV(rows)` / `parseCSV(text)` | Convert between a `string[][]` matrix and CSV text                |
| `snapshotToXlsx(snapshot, opts?)` | Zero-dependency `GridSnapshot` → `.xlsx` bytes (`Promise<Uint8Array>`), preserving formulas, styles, number formats, and column widths (single sheet) |
| `xlsxToSnapshot(bytes)`        | Zero-dependency `.xlsx` bytes → `GridSnapshot` (`Promise<GridSnapshot>`, first sheet only) |
| `workbookToXlsx(sheets)`       | `XlsxSheet[]` (`{ name, snapshot }[]`) → `.xlsx` bytes (`Promise<Uint8Array>`), all sheets in one workbook sharing an interned style table |
| `xlsxToWorkbook(bytes)`        | `.xlsx` bytes → `XlsxSheet[]` (`Promise<XlsxSheet[]>`), every sheet in workbook order |

The demo app (`npm run dev`) shows a full example: New/Open…/Save CSV/Save
XLSX buttons, a sheet-tab row (switch/add/rename/delete sheets),
content-sniffed file opening (`.xlsx` detected by PK magic bytes, not
extension) that loads every sheet of a workbook, and debounced localStorage
autosave (all sheets + active sheet) driven by `onStateChange` +
`getSnapshot()`.

## Development

```sh
npm run dev        # demo app on :5199
npm test           # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # dist/ (ESM + CJS + d.ts + styles.css)
```

## Not (yet) included

Row resize, autofilter dropdowns (only filter-by-value), cross-sheet
formula references (`=Sheet2!A1`), sheet tab reordering, touch gestures.
Cell styles are display-only and not exposed through `getData()` (use
`getSnapshot()` for styles). Sorting moves raw content only (styles and
formula references are not rewritten by sort). Borders support solid
thin/medium/thick lines only (no dashed/dotted/double/diagonal). Format
painter is single-use (no Excel-style double-click-to-lock) and always
broadcasts the source selection's top-left cell style rather than tiling a
multi-cell pattern. Merges are not guaranteed to render correctly when they
straddle a frozen-pane boundary, and the fill handle's behavior when
dragging across a merged cell is undefined.
