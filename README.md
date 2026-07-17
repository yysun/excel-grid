# excel-grid

An Excel-style spreadsheet grid for React — cell editing, formulas with live
recalculation, keyboard navigation, clipboard interop, undo/redo, column
resize, and a fill handle, in a virtualized grid that handles 10,000 × 100
cells and beyond. No runtime dependencies besides React.

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
| `onChange`        | `(changes: GridChange[]) => void`| —       | Fires per committed batch (edit/paste/fill/undo…)  |
| `rowHeight`       | `number`                         | `24`    | Row height in px                                   |
| `defaultColWidth` | `number`                         | `100`   | Default column width in px                         |
| `className`       | `string`                         | —       | Extra class on the root element                    |

## Ref API (`ExcelGridHandle`)

| Method                 | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `getCell(ref)`         | `{ raw, value, error? }` for an A1-style ref, or `null`  |
| `setCell(ref, raw)`    | Write a cell (undoable, recalculates dependents)         |
| `getData()`            | All non-empty cells as `{ ref, raw, value }[]`           |

## Interactions

- **Select**: click, drag, Shift+click / Shift+arrows, row/column header click, Ctrl/Cmd+A.
- **Navigate**: arrows, Tab/Shift+Tab, Enter/Shift+Enter, Home, Ctrl/Cmd+Home, PageUp/PageDown.
- **Edit**: double-click, F2, or just start typing; Enter/Tab commit (moving down/right), Escape cancels; Delete clears the selection; the formula bar edits the active cell.
- **Clipboard**: Ctrl/Cmd+C/X/V with TSV interop (pastes to/from Excel and Google Sheets). Copied formulas adjust relative references by the paste offset.
- **Undo/redo**: Ctrl/Cmd+Z, Ctrl/Cmd+Y or Shift+Ctrl/Cmd+Z.
- **Resize**: drag a column header's right edge.
- **Fill**: drag the square handle at the selection corner down or right.

## Formulas

Start a cell with `=`. Supported: numbers, strings (`"…"`), booleans, cell
refs (`A1`, `$A$1`), ranges (`A1:B3`), operators `+ - * / ^ % &` and
comparisons `= <> < <= > >=`, and functions:

`SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ROUND, ABS, CONCATENATE, AND, OR, NOT`

Dependents recalculate automatically. Errors follow Excel conventions:
`#NAME?`, `#VALUE!`, `#DIV/0!`, `#REF!`, and `#CYCLE!` for circular
references.

## Development

```sh
npm run dev        # demo app on :5199
npm test           # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # dist/ (ESM + CJS + d.ts + styles.css)
```

## Not (yet) included

Cell formatting, merged cells, frozen panes, row resize, sorting/filtering,
multi-sheet workbooks, `.xlsx` import/export, touch gestures.
