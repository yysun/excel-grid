// Central grid state store (framework-agnostic, consumed via useSyncExternalStore).
// Features: sparse cell map keyed "row,col"; literal parsing (numbers/booleans/
// text); formula parsing + incremental recalculation through a dependency
// graph with #CYCLE! detection; undo/redo as inverse patch batches; column
// widths; change notification with computed values; sparse per-cell styles
// (applyStyle/clearFormat, undoable) with number-format aware display;
// structural edits (insert/delete/move rows/cols) via a single index-remap
// primitive with sheet-snapshot undo and sheet-wide formula rewriting;
// hidden rows/cols, Excel-style per-column value-set filters (filterCols =
// columns showing a filter button, colFilters = allowed value keys per
// column, filteredRows derived on notify), frozen pane counts (view state,
// not undoable), range sorting, and used-range computation.
// Recent changes: formatNumber gained "date"/"time"/"datetime"/"duration"
// renderings (Excel-style serial numbers, UTC) delegating to
// utils/dateSerial; parseLiteral now recognizes strict date/time/datetime
// literals (after the existing number/boolean checks) and stores their
// serial. Auto-applying the matching format on first entry lives in
// setCells, not here, so undo replay and structural rewrites (which call
// applyRaw directly) never re-trigger format detection.

import { FormulaError, type ErrorCode } from "../formula/errors";
import { evaluate, type EvalContext } from "../formula/evaluate";
import { extractRefs, hasRefError, remapFormulaAxis } from "../formula/adjust";
import { parse, type Ast } from "../formula/parser";
import { formatDateSerial, parseDateTimeLiteral } from "../utils/dateSerial";
import type {
  CellData,
  CellRange,
  CellStyle,
  CellValue,
  GridChange,
} from "../types";
import {
  cellKey,
  formatCellRef,
  parseKey,
  rangeContains,
  rangeCoords,
} from "../utils/cellRef";

interface CellRecord {
  raw: string;
  ast: Ast | null;
  value: CellValue;
  error?: ErrorCode;
}

interface RawPatch {
  kind: "raw";
  row: number;
  col: number;
  before: string | null;
  after: string | null;
}

interface StylePatch {
  kind: "style";
  row: number;
  col: number;
  before: CellStyle | null;
  after: CellStyle | null;
}

/** Sparse copy of all remappable sheet state, for structural undo. */
interface SheetSnapshot {
  raws: Map<string, string>;
  styles: Map<string, CellStyle>;
  colWidths: Map<number, number>;
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
  filterCols: Set<number>;
  colFilters: Map<number, Set<string>>;
}

interface SheetPatch {
  kind: "sheet";
  before: SheetSnapshot;
  after: SheetSnapshot;
}

type Patch = RawPatch | StylePatch | SheetPatch;

type Axis = "row" | "col";
export type SortDir = "asc" | "desc";

/** Styling a range larger than this is a no-op to keep the UI responsive. */
export const STYLE_CELL_CAP = 200_000;

export interface RawChange {
  row: number;
  col: number;
  raw: string | null;
}

export class GridStore {
  private cells = new Map<string, CellRecord>();
  /** Sparse per-cell styles, independent of cell values. */
  private styles = new Map<string, CellStyle>();
  /** cellKey -> formula cell keys that reference it directly. */
  private dependents = new Map<string, Set<string>>();
  /** Range dependencies: any change inside `range` dirties `dependent`. */
  private rangeDeps: Array<{ range: CellRange; dependent: string }> = [];
  private undoStack: Patch[][] = [];
  private redoStack: Patch[][] = [];
  private colWidths = new Map<number, number>();
  /** Manually hidden lines (view state; remapped by structural edits). */
  private hiddenRows = new Set<number>();
  private hiddenCols = new Set<number>();
  /** Columns showing a filter button (filter mode). */
  private filterCols = new Set<number>();
  /** Per-column allowed value keys; a column absent here filters nothing. */
  private colFilters = new Map<number, Set<string>>();
  /** Rows hidden by column filters. Derived cache; rebuilt in notify. */
  private filteredRows = new Set<number>();
  private frozenRows = 0;
  private frozenCols = 0;
  private version = 0;
  private listeners = new Set<() => void>();

  onChange: ((changes: GridChange[]) => void) | null = null;

  constructor(
    public readonly rowCount: number,
    public readonly colCount: number,
    public readonly defaultColWidth: number
  ) {}

  // ---- subscription ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private notify(changes: GridChange[]): void {
    // The second clause clears stale hidden rows after the last filter is
    // removed (clear paths empty colFilters before notifying).
    if (this.colFilters.size > 0 || this.filteredRows.size > 0) {
      this.recomputeFilteredRows();
    }
    this.version++;
    this.listeners.forEach((l) => l());
    if (changes.length > 0 && this.onChange) this.onChange(changes);
  }

  // ---- reads ----

  getCell(row: number, col: number): CellData | null {
    const rec = this.cells.get(cellKey(row, col));
    if (!rec) return null;
    return { raw: rec.raw, value: rec.value, error: rec.error };
  }

  /** Text shown in the cell (number-format aware). */
  getDisplay(row: number, col: number): string {
    const key = cellKey(row, col);
    const rec = this.cells.get(key);
    if (!rec) return "";
    if (rec.error) return rec.error;
    if (rec.value === null) return "";
    if (typeof rec.value === "boolean") return rec.value ? "TRUE" : "FALSE";
    if (typeof rec.value === "number") {
      const style = this.styles.get(key);
      if (style && (style.numFmt !== undefined || style.decimals !== undefined)) {
        return formatNumber(rec.value, style);
      }
    }
    return String(rec.value);
  }

  /** Raw editing text (formula source) of a cell. */
  getRaw(row: number, col: number): string {
    return this.cells.get(cellKey(row, col))?.raw ?? "";
  }

  getAllCells(): Array<{ row: number; col: number; raw: string; value: CellValue }> {
    const out: Array<{ row: number; col: number; raw: string; value: CellValue }> = [];
    for (const [key, rec] of this.cells) {
      const { row, col } = parseKey(key);
      out.push({ row, col, raw: rec.raw, value: rec.value });
    }
    return out;
  }

  getColWidth(col: number): number {
    return this.colWidths.get(col) ?? this.defaultColWidth;
  }

  setColWidth(col: number, width: number): void {
    this.colWidths.set(col, Math.max(30, width));
    this.notify([]);
  }

  getStyle(row: number, col: number): CellStyle | null {
    return this.styles.get(cellKey(row, col)) ?? null;
  }

  /** True when the row is hidden manually or by the active filter. */
  isRowHidden(row: number): boolean {
    return this.hiddenRows.has(row) || this.filteredRows.has(row);
  }

  isColHidden(col: number): boolean {
    return this.hiddenCols.has(col);
  }

  /**
   * True if any row in [start..end] is manually hidden. Filter-hidden rows
   * are excluded: unhide cannot restore them (Clear filter does).
   */
  hasHiddenRowsIn(start: number, end: number): boolean {
    for (let r = start; r <= end; r++) if (this.hiddenRows.has(r)) return true;
    return false;
  }

  hasHiddenColsIn(start: number, end: number): boolean {
    for (let c = start; c <= end; c++) if (this.hiddenCols.has(c)) return true;
    return false;
  }

  /** True while filter mode is on (any column shows a filter button). */
  hasFilter(): boolean {
    return this.filterCols.size > 0;
  }

  /** True when at least one column has an active (excluding) filter. */
  hasActiveFilters(): boolean {
    return this.colFilters.size > 0;
  }

  hasActiveColFilter(col: number): boolean {
    return this.colFilters.has(col);
  }

  isFilterCol(col: number): boolean {
    return this.filterCols.has(col);
  }

  getFilterCols(): Set<number> {
    return new Set(this.filterCols);
  }

  /** Allowed value keys for the column's filter, or null when unfiltered. */
  getColFilter(col: number): Set<string> | null {
    const allowed = this.colFilters.get(col);
    return allowed ? new Set(allowed) : null;
  }

  getFrozenRows(): number {
    return this.frozenRows;
  }

  getFrozenCols(): number {
    return this.frozenCols;
  }

  /** Hide or unhide rows [start..end]. View state: not undoable. */
  setRowsHidden(start: number, end: number, hidden: boolean): void {
    for (let r = Math.max(0, start); r <= Math.min(this.rowCount - 1, end); r++) {
      if (hidden) this.hiddenRows.add(r);
      else this.hiddenRows.delete(r);
    }
    this.notify([]);
  }

  /** Hide or unhide columns [start..end]. View state: not undoable. */
  setColsHidden(start: number, end: number, hidden: boolean): void {
    for (let c = Math.max(0, start); c <= Math.min(this.colCount - 1, end); c++) {
      if (hidden) this.hiddenCols.add(c);
      else this.hiddenCols.delete(c);
    }
    this.notify([]);
  }

  /** Freeze the first n rows (0 unfreezes). View state: not undoable. */
  setFrozenRows(n: number): void {
    this.frozenRows = Math.max(0, Math.min(this.rowCount - 1, n));
    this.notify([]);
  }

  setFrozenCols(n: number): void {
    this.frozenCols = Math.max(0, Math.min(this.colCount - 1, n));
    this.notify([]);
  }

  /** Bounding box of all non-empty cells, or null for an empty sheet. */
  getUsedRange(): CellRange | null {
    let range: CellRange | null = null;
    for (const key of this.cells.keys()) {
      const { row, col } = parseKey(key);
      if (range === null) {
        range = { startRow: row, endRow: row, startCol: col, endCol: col };
      } else {
        range.startRow = Math.min(range.startRow, row);
        range.endRow = Math.max(range.endRow, row);
        range.startCol = Math.min(range.startCol, col);
        range.endCol = Math.max(range.endCol, col);
      }
    }
    return range;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ---- writes ----

  /** Apply a batch of raw-text changes as one undoable action. */
  setCells(changes: RawChange[], record = true): void {
    if (changes.length === 0) return;
    const patches: Patch[] = [];
    const touched: string[] = [];
    for (const c of changes) {
      if (c.row < 0 || c.col < 0 || c.row >= this.rowCount || c.col >= this.colCount) {
        continue;
      }
      const key = cellKey(c.row, c.col);
      const before = this.cells.get(key)?.raw ?? null;
      const after = c.raw === "" ? null : c.raw;
      if (before === after) continue;
      patches.push({ kind: "raw", row: c.row, col: c.col, before, after });
      this.applyRaw(c.row, c.col, after);
      touched.push(key);
      // Auto-apply the matching date/time format on first entry of an
      // unambiguous literal, in the same undo batch as the raw change,
      // but only over a cell with no explicit numFmt yet.
      if (after !== null && !after.startsWith("=")) {
        const dt = parseDateTimeLiteral(after.trim());
        if (dt) {
          const styleBefore = this.styles.get(key) ?? null;
          if (styleBefore?.numFmt === undefined) {
            const styleAfter = mergeStyle(styleBefore, { numFmt: dt.fmt });
            patches.push({ kind: "style", row: c.row, col: c.col, before: styleBefore, after: styleAfter });
            this.setStyleRecord(c.row, c.col, styleAfter);
          }
        }
      }
    }
    if (patches.length === 0) return;
    if (record) {
      this.undoStack.push(patches);
      this.redoStack = [];
    }
    const recomputed = this.recompute(touched);
    this.notify(this.toGridChanges(new Set([...touched, ...recomputed])));
  }

  clearRange(range: CellRange): void {
    // Iterate occupied cells, not range coordinates: clearing a whole-sheet
    // selection must not walk millions of empty coordinates.
    const changes: RawChange[] = [];
    for (const key of this.cells.keys()) {
      const { row, col } = parseKey(key);
      if (rangeContains(range, row, col)) changes.push({ row, col, raw: null });
    }
    this.setCells(changes);
  }

  /**
   * Merge a style patch into every cell of `range` as one undoable action.
   * A key present in `patch` whose value is `undefined` removes that
   * property. Ranges above STYLE_CELL_CAP cells are a no-op.
   */
  applyStyle(range: CellRange, patch: Partial<CellStyle>): void {
    const r = this.clampRange(range);
    const count = (r.endRow - r.startRow + 1) * (r.endCol - r.startCol + 1);
    if (count <= 0 || count > STYLE_CELL_CAP) return;
    const patches: Patch[] = [];
    for (let row = r.startRow; row <= r.endRow; row++) {
      for (let col = r.startCol; col <= r.endCol; col++) {
        const key = cellKey(row, col);
        const before = this.styles.get(key) ?? null;
        const after = mergeStyle(before, patch);
        if (stylesEqual(before, after)) continue;
        patches.push({ kind: "style", row, col, before, after });
        this.setStyleRecord(row, col, after);
      }
    }
    this.commitStylePatches(patches);
  }

  /** Remove all styling from cells in `range` as one undoable action. */
  clearFormat(range: CellRange): void {
    // Iterate occupied style records only, like clearRange.
    const patches: StylePatch[] = [];
    for (const [key, style] of this.styles) {
      const { row, col } = parseKey(key);
      if (!rangeContains(range, row, col)) continue;
      patches.push({ kind: "style", row, col, before: style, after: null });
    }
    for (const p of patches) this.setStyleRecord(p.row, p.col, null);
    this.commitStylePatches(patches);
  }

  // ---- structural edits (insert/delete/move) ----

  /** Insert n rows before `at`; content at the sheet edge is dropped. */
  insertRows(at: number, n: number): void {
    if (n <= 0 || at < 0 || at > this.rowCount) return;
    this.remapAxis("row", (i) => (i < at ? i : i + n));
  }

  insertCols(at: number, n: number): void {
    if (n <= 0 || at < 0 || at > this.colCount) return;
    this.remapAxis("col", (i) => (i < at ? i : i + n));
  }

  /** Delete rows [start..end]; references to them become #REF!. */
  deleteRows(start: number, end: number): void {
    if (start < 0 || end < start || end >= this.rowCount) return;
    const n = end - start + 1;
    this.remapAxis("row", (i) => (i < start ? i : i <= end ? null : i - n));
  }

  deleteCols(start: number, end: number): void {
    if (start < 0 || end < start || end >= this.colCount) return;
    const n = end - start + 1;
    this.remapAxis("col", (i) => (i < start ? i : i <= end ? null : i - n));
  }

  /** Swap rows [start..end] with the adjacent row in direction dir. */
  moveRows(start: number, end: number, dir: -1 | 1): void {
    if (start < 0 || end < start || end >= this.rowCount) return;
    if (dir === -1 ? start === 0 : end === this.rowCount - 1) return;
    this.remapAxis("row", blockSwapMap(start, end, dir));
  }

  moveCols(start: number, end: number, dir: -1 | 1): void {
    if (start < 0 || end < start || end >= this.colCount) return;
    if (dir === -1 ? start === 0 : end === this.colCount - 1) return;
    this.remapAxis("col", blockSwapMap(start, end, dir));
  }

  /**
   * Remap one axis's indices through `map` (null / out-of-bounds = dropped):
   * moves raw content, styles, column widths, and hidden flags, rewrites
   * every formula's references on that axis, and records one undoable
   * SheetPatch.
   */
  private remapAxis(axis: Axis, map: (i: number) => number | null): void {
    const count = axis === "row" ? this.rowCount : this.colCount;
    const mapKey = (key: string): string | null => {
      const { row, col } = parseKey(key);
      const mapped = map(axis === "row" ? row : col);
      if (mapped === null || mapped < 0 || mapped >= count) return null;
      return axis === "row" ? cellKey(mapped, col) : cellKey(row, mapped);
    };
    const before = this.snapshotSheet();
    const after: SheetSnapshot = {
      raws: new Map(),
      styles: new Map(),
      colWidths: axis === "col" ? new Map() : new Map(this.colWidths),
      hiddenRows: axis === "row" ? new Set() : new Set(this.hiddenRows),
      hiddenCols: axis === "col" ? new Set() : new Set(this.hiddenCols),
      filterCols: axis === "col" ? new Set() : new Set(this.filterCols),
      colFilters:
        axis === "col" ? new Map() : copyColFilters(this.colFilters),
    };
    for (const [key, rec] of this.cells) {
      const nk = mapKey(key);
      if (nk === null) continue;
      const raw = rec.raw.startsWith("=")
        ? remapFormulaAxis(rec.raw, axis, map, this.rowCount, this.colCount)
        : rec.raw;
      after.raws.set(nk, raw);
    }
    for (const [key, style] of this.styles) {
      const nk = mapKey(key);
      if (nk !== null) after.styles.set(nk, { ...style });
    }
    if (axis === "col") {
      for (const [col, width] of this.colWidths) {
        const mapped = map(col);
        if (mapped !== null && mapped >= 0 && mapped < count) {
          after.colWidths.set(mapped, width);
        }
      }
      for (const col of this.hiddenCols) {
        const mapped = map(col);
        if (mapped !== null && mapped >= 0 && mapped < count) {
          after.hiddenCols.add(mapped);
        }
      }
      for (const col of this.filterCols) {
        const mapped = map(col);
        if (mapped !== null && mapped >= 0 && mapped < count) {
          after.filterCols.add(mapped);
        }
      }
      for (const [col, allowed] of this.colFilters) {
        const mapped = map(col);
        if (mapped !== null && mapped >= 0 && mapped < count) {
          after.colFilters.set(mapped, new Set(allowed));
        }
      }
    } else {
      for (const row of this.hiddenRows) {
        const mapped = map(row);
        if (mapped !== null && mapped >= 0 && mapped < count) {
          after.hiddenRows.add(mapped);
        }
      }
    }
    if (sheetSnapshotsEqual(before, after)) return; // e.g. edge no-ops
    const touched = this.restoreSheet(after);
    const recomputed = this.recompute(touched);
    this.undoStack.push([{ kind: "sheet", before, after }]);
    this.redoStack = [];
    this.notify(this.toGridChanges(new Set([...touched, ...recomputed])));
  }

  private snapshotSheet(): SheetSnapshot {
    const raws = new Map<string, string>();
    for (const [key, rec] of this.cells) raws.set(key, rec.raw);
    return {
      raws,
      styles: new Map([...this.styles].map(([k, v]) => [k, { ...v }])),
      colWidths: new Map(this.colWidths),
      hiddenRows: new Set(this.hiddenRows),
      hiddenCols: new Set(this.hiddenCols),
      filterCols: new Set(this.filterCols),
      colFilters: copyColFilters(this.colFilters),
    };
  }

  /**
   * Replace all sheet state with a snapshot and rebuild the dependency
   * graph. Returns the union of previously and newly occupied keys; the
   * caller is responsible for recompute + notify.
   */
  private restoreSheet(snap: SheetSnapshot): string[] {
    const keys = new Set(this.cells.keys());
    this.cells.clear();
    this.dependents.clear();
    this.rangeDeps = [];
    this.styles = new Map([...snap.styles].map(([k, v]) => [k, { ...v }]));
    this.colWidths = new Map(snap.colWidths);
    this.hiddenRows = new Set(snap.hiddenRows);
    this.hiddenCols = new Set(snap.hiddenCols);
    this.filterCols = new Set(snap.filterCols);
    this.colFilters = copyColFilters(snap.colFilters);
    for (const [key, raw] of snap.raws) {
      const { row, col } = parseKey(key);
      this.applyRaw(row, col, raw);
      keys.add(key);
    }
    return [...keys];
  }

  // ---- sort and filter ----

  /**
   * Reorder the rows of `range` by the computed value in `keyCol` as one
   * undoable raw batch. Numbers sort before text (case-insensitive);
   * blanks always sort last. Styles do not move.
   */
  sortRange(range: CellRange, keyCol: number, dir: SortDir): void {
    const r = this.clampRange(range);
    if (r.endRow <= r.startRow) return;
    const order: number[] = [];
    for (let row = r.startRow; row <= r.endRow; row++) order.push(row);
    const keyOf = (row: number): CellValue =>
      this.cells.get(cellKey(row, keyCol))?.value ?? null;
    order.sort((a, b) => compareCellValues(keyOf(a), keyOf(b), dir));
    const changes: RawChange[] = [];
    order.forEach((srcRow, i) => {
      const destRow = r.startRow + i;
      if (srcRow === destRow) return;
      for (let col = r.startCol; col <= r.endCol; col++) {
        const raw = this.getRaw(srcRow, col);
        changes.push({ row: destRow, col, raw: raw === "" ? null : raw });
      }
    });
    this.setCells(changes);
  }

  /**
   * Replace the set of filter-button columns (toolbar toggle on). Filters
   * on columns dropped from the set are removed. View state: not undoable.
   */
  setFilterCols(cols: number[]): void {
    this.filterCols = new Set(
      cols.filter((c) => c >= 0 && c < this.colCount)
    );
    for (const col of [...this.colFilters.keys()]) {
      if (!this.filterCols.has(col)) this.colFilters.delete(col);
    }
    this.notify([]);
  }

  /** Toolbar toggle off: remove every filter button and every filter. */
  clearFilterCols(): void {
    if (this.filterCols.size === 0 && this.colFilters.size === 0) return;
    this.filterCols.clear();
    this.colFilters.clear();
    this.notify([]);
  }

  /** Clear all column filters but keep the filter buttons visible. */
  clearColFilters(): void {
    if (this.colFilters.size === 0) return;
    this.colFilters.clear();
    this.notify([]);
  }

  /**
   * Set the allowed value-key set for one column (null clears that
   * column's filter). Ensures the column shows a filter button. Filters
   * on multiple columns combine with AND.
   */
  setColFilter(col: number, allowed: Set<string> | null): void {
    if (col < 0 || col >= this.colCount) return;
    this.filterCols.add(col);
    if (allowed === null) this.colFilters.delete(col);
    else this.colFilters.set(col, new Set(allowed));
    this.notify([]);
  }

  /**
   * Distinct values of `col` within the used range, sorted ascending
   * (numbers before text, blanks last), with occurrence counts. `key` is
   * the filterValueKey; blank cells collapse into the "" entry.
   */
  getColumnValues(
    col: number
  ): Array<{ key: string; label: string; count: number }> {
    const used = this.getUsedRange();
    if (!used) return [];
    const byKey = new Map<string, { value: CellValue; count: number }>();
    for (let r = used.startRow; r <= used.endRow; r++) {
      const v = this.cells.get(cellKey(r, col))?.value ?? null;
      const key = filterValueKey(v);
      const entry = byKey.get(key);
      if (entry) entry.count++;
      else byKey.set(key, { value: v, count: 1 });
    }
    return [...byKey.entries()]
      .sort((a, b) => compareCellValues(a[1].value, b[1].value, "asc"))
      .map(([key, { count }]) => ({ key, label: key, count }));
  }

  /** Rebuild the derived filteredRows cache from colFilters. */
  private recomputeFilteredRows(): void {
    this.filteredRows.clear();
    if (this.colFilters.size === 0) return;
    const used = this.getUsedRange();
    if (!used) return;
    for (let r = used.startRow; r <= used.endRow; r++) {
      for (const [col, allowed] of this.colFilters) {
        const v = this.cells.get(cellKey(r, col))?.value ?? null;
        if (!allowed.has(filterValueKey(v))) {
          this.filteredRows.add(r);
          break;
        }
      }
    }
  }

  undo(): void {
    const batch = this.undoStack.pop();
    if (!batch) return;
    this.redoStack.push(batch);
    this.applyPatchBatch(batch, "before");
  }

  redo(): void {
    const batch = this.redoStack.pop();
    if (!batch) return;
    this.undoStack.push(batch);
    this.applyPatchBatch(batch, "after");
  }

  private applyPatchBatch(batch: Patch[], side: "before" | "after"): void {
    const touched: string[] = [];
    for (const p of batch) {
      if (p.kind === "raw") {
        this.applyRaw(p.row, p.col, p[side]);
        touched.push(cellKey(p.row, p.col));
      } else if (p.kind === "style") {
        this.setStyleRecord(p.row, p.col, p[side]);
      } else {
        touched.push(...this.restoreSheet(p[side]));
      }
    }
    const recomputed = this.recompute(touched);
    this.notify(this.toGridChanges(new Set([...touched, ...recomputed])));
  }

  private commitStylePatches(patches: Patch[]): void {
    if (patches.length === 0) return;
    this.undoStack.push(patches);
    this.redoStack = [];
    this.notify([]);
  }

  private setStyleRecord(row: number, col: number, style: CellStyle | null): void {
    const key = cellKey(row, col);
    if (style === null) this.styles.delete(key);
    else this.styles.set(key, style);
  }

  private clampRange(range: CellRange): CellRange {
    return {
      startRow: Math.max(0, range.startRow),
      startCol: Math.max(0, range.startCol),
      endRow: Math.min(this.rowCount - 1, range.endRow),
      endCol: Math.min(this.colCount - 1, range.endCol),
    };
  }

  // ---- internals ----

  private toGridChanges(keys: Set<string>): GridChange[] {
    const out: GridChange[] = [];
    for (const key of keys) {
      const { row, col } = parseKey(key);
      const rec = this.cells.get(key);
      out.push({
        row,
        col,
        ref: formatCellRef(row, col),
        raw: rec?.raw ?? null,
        value: rec?.value ?? null,
        error: rec?.error,
      });
    }
    return out;
  }

  /** Set one cell's raw text (null clears) and refresh its dependency registration. */
  private applyRaw(row: number, col: number, raw: string | null): void {
    const key = cellKey(row, col);
    this.unregisterDeps(key);
    if (raw === null) {
      this.cells.delete(key);
      return;
    }
    if (raw.startsWith("=") && raw.length > 1) {
      let ast: Ast | null = null;
      let error: ErrorCode | undefined;
      try {
        ast = parse(raw.slice(1));
      } catch (e) {
        error = hasRefError(raw)
          ? "#REF!"
          : e instanceof FormulaError
            ? e.code
            : "#VALUE!";
      }
      this.cells.set(key, { raw, ast, value: error ?? null, error });
      if (ast) this.registerDeps(key, ast);
      return;
    }
    this.cells.set(key, { raw, ast: null, value: parseLiteral(raw) });
  }

  private registerDeps(key: string, ast: Ast): void {
    const refs = extractRefs(ast);
    for (const c of refs.cells) {
      const depKey = cellKey(c.row, c.col);
      let set = this.dependents.get(depKey);
      if (!set) this.dependents.set(depKey, (set = new Set()));
      set.add(key);
    }
    for (const range of refs.ranges) {
      this.rangeDeps.push({ range, dependent: key });
    }
  }

  private unregisterDeps(key: string): void {
    for (const set of this.dependents.values()) set.delete(key);
    this.rangeDeps = this.rangeDeps.filter((rd) => rd.dependent !== key);
  }

  private directDependents(key: string): string[] {
    const { row, col } = parseKey(key);
    const out = new Set<string>(this.dependents.get(key) ?? []);
    for (const rd of this.rangeDeps) {
      if (rangeContains(rd.range, row, col)) out.add(rd.dependent);
    }
    out.delete(key);
    return [...out];
  }

  /**
   * Recompute every formula affected by the touched cells.
   * Returns the keys that were recomputed (beyond the touched set).
   */
  private recompute(touchedKeys: string[]): string[] {
    const dirty = new Set<string>();
    const queue = [...touchedKeys];
    for (const key of touchedKeys) {
      if (this.cells.get(key)?.ast) dirty.add(key);
    }
    while (queue.length > 0) {
      const key = queue.pop()!;
      for (const dep of this.directDependents(key)) {
        if (!dirty.has(dep)) {
          dirty.add(dep);
          queue.push(dep);
        }
      }
    }
    const state = new Map<string, "computing" | "done">();
    const evalKey = (key: string): void => {
      if (state.get(key) === "done") return;
      if (state.get(key) === "computing") throw new FormulaError("#CYCLE!");
      state.set(key, "computing");
      const rec = this.cells.get(key);
      if (rec && rec.ast) {
        try {
          rec.value = evaluate(rec.ast, this.makeContext(dirty, state, evalKey));
          rec.error = undefined;
        } catch (e) {
          rec.error = e instanceof FormulaError ? e.code : "#VALUE!";
          rec.value = rec.error;
        }
      }
      state.set(key, "done");
    };
    for (const key of dirty) {
      try {
        evalKey(key);
      } catch (e) {
        // A cycle surfaced at the entry cell itself.
        const rec = this.cells.get(key);
        if (rec) {
          rec.error = e instanceof FormulaError ? e.code : "#VALUE!";
          rec.value = rec.error;
        }
        state.set(key, "done");
      }
    }
    const touchedSet = new Set(touchedKeys);
    return [...dirty].filter((k) => !touchedSet.has(k));
  }

  private makeContext(
    dirty: Set<string>,
    state: Map<string, "computing" | "done">,
    evalKey: (key: string) => void
  ): EvalContext {
    const resolve = (row: number, col: number): CellValue => {
      if (row < 0 || col < 0 || row >= this.rowCount || col >= this.colCount) {
        throw new FormulaError("#REF!");
      }
      const key = cellKey(row, col);
      if (dirty.has(key) && state.get(key) !== "done") {
        evalKey(key); // May throw #CYCLE!, which propagates to the caller.
      }
      const rec = this.cells.get(key);
      if (!rec) return null;
      if (rec.error) throw new FormulaError(rec.error);
      return rec.value;
    };
    return {
      getCellValue: resolve,
      getRangeValues: (range) => {
        const out: CellValue[] = [];
        for (const { row, col } of rangeCoords(range)) {
          out.push(resolve(row, col));
        }
        return out;
      },
    };
  }
}

/** Deep equality of sheet snapshots, to skip recording no-op edits. */
function sheetSnapshotsEqual(a: SheetSnapshot, b: SheetSnapshot): boolean {
  const mapsEqual = <V>(
    x: Map<string | number, V>,
    y: Map<string | number, V>,
    eq: (p: V, q: V) => boolean
  ): boolean => {
    if (x.size !== y.size) return false;
    for (const [k, v] of x) {
      const w = y.get(k);
      if (w === undefined || !eq(v, w)) return false;
    }
    return true;
  };
  const setsEqual = <T,>(x: Set<T>, y: Set<T>): boolean =>
    x.size === y.size && [...x].every((v) => y.has(v));
  return (
    mapsEqual(a.raws, b.raws, (p, q) => p === q) &&
    mapsEqual(a.styles, b.styles, stylesEqual) &&
    mapsEqual(a.colWidths, b.colWidths, (p, q) => p === q) &&
    setsEqual(a.hiddenRows, b.hiddenRows) &&
    setsEqual(a.hiddenCols, b.hiddenCols) &&
    setsEqual(a.filterCols, b.filterCols) &&
    mapsEqual(a.colFilters, b.colFilters, setsEqual)
  );
}

/** Deep copy so snapshots never alias the live inner Sets. */
function copyColFilters(
  src: Map<number, Set<string>>
): Map<number, Set<string>> {
  return new Map([...src].map(([col, allowed]) => [col, new Set(allowed)]));
}

/**
 * Canonical string key for a computed cell value in column filters: "" for
 * blank, TRUE/FALSE for booleans, String(n) for numbers (numFmt styling is
 * deliberately ignored so equal values are one filter entry).
 */
export function filterValueKey(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

/**
 * Index mapping that swaps block [start..end] with the single adjacent line
 * in direction dir (-1 = up/left, 1 = down/right).
 */
function blockSwapMap(
  start: number,
  end: number,
  dir: -1 | 1
): (i: number) => number {
  return (i) => {
    if (dir === -1) {
      if (i === start - 1) return end;
      return i >= start && i <= end ? i - 1 : i;
    }
    if (i === end + 1) return start;
    return i >= start && i <= end ? i + 1 : i;
  };
}

/**
 * Sort comparator: numbers ascending first, then text case-insensitively
 * (booleans compare as text), blanks always last regardless of direction;
 * `desc` reverses non-blank order only. Ties keep insertion order (stable).
 */
export function compareCellValues(
  a: CellValue,
  b: CellValue,
  dir: SortDir
): number {
  const rank = (v: CellValue): number =>
    v === null ? 2 : typeof v === "number" ? 0 : 1;
  const ra = rank(a);
  const rb = rank(b);
  if (ra === 2 || rb === 2) return ra - rb;
  let c: number;
  if (ra !== rb) {
    c = ra - rb;
  } else if (ra === 0) {
    c = (a as number) - (b as number);
  } else {
    const sa = String(a).toLowerCase();
    const sb = String(b).toLowerCase();
    c = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return dir === "asc" ? c : -c;
}

/** Merge a partial style into a base style; `undefined` values remove keys. */
function mergeStyle(
  base: CellStyle | null,
  patch: Partial<CellStyle>
): CellStyle | null {
  const out: CellStyle = { ...(base ?? {}) };
  for (const k of Object.keys(patch) as (keyof CellStyle)[]) {
    const v = patch[k];
    if (v === undefined) delete out[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
}

function stylesEqual(a: CellStyle | null, b: CellStyle | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a) as (keyof CellStyle)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

/** Format a numeric value for display according to the cell's style. */
export function formatNumber(v: number, style: CellStyle): string {
  const d = style.decimals;
  switch (style.numFmt) {
    case "percent":
      return (v * 100).toFixed(d ?? 0) + "%";
    case "thousands":
      return v.toLocaleString(
        "en-US",
        d === undefined
          ? { maximumFractionDigits: 10 }
          : { minimumFractionDigits: d, maximumFractionDigits: d }
      );
    case "number":
      return groupedFixed(v, d ?? 2);
    case "currency":
      return v < 0
        ? "-$" + groupedFixed(-v, d ?? 2)
        : "$" + groupedFixed(v, d ?? 2);
    case "scientific":
      return v.toExponential(d ?? 2).toUpperCase();
    case "date":
    case "time":
    case "datetime":
    case "duration":
      return formatDateSerial(v, style.numFmt) ?? plainNumber(v, d);
    default:
      return plainNumber(v, d);
  }
}

/** Plain (no numFmt) numeric rendering, honoring an explicit decimals override. */
function plainNumber(v: number, d: number | undefined): string {
  return d === undefined ? String(v) : v.toFixed(d);
}

/** en-US grouped rendering with a fixed fraction-digit count. */
function groupedFixed(v: number, digits: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Parse non-formula raw text into a value: number, boolean, date/time serial, or string. */
export function parseLiteral(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed !== "" && !isNaN(Number(trimmed))) return Number(trimmed);
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  const dt = parseDateTimeLiteral(trimmed);
  if (dt) return dt.serial;
  return raw;
}
