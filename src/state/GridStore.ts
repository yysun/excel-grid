// Central grid state store (framework-agnostic, consumed via useSyncExternalStore).
// Features: sparse cell map keyed "row,col"; literal parsing (numbers/booleans/
// text); formula parsing + incremental recalculation through a dependency
// graph with #CYCLE! detection; undo/redo as inverse patch batches; column
// widths; change notification with computed values; sparse per-cell styles
// (applyStyle/clearFormat, undoable) with number-format aware display.
// Recent changes: added the style layer — styles map, raw/style patch union
// on the shared undo stacks, applyStyle/clearFormat/getStyle, and
// percent/thousands/decimals formatting in getDisplay.

import { FormulaError, type ErrorCode } from "../formula/errors";
import { evaluate, type EvalContext } from "../formula/evaluate";
import { extractRefs, hasRefError } from "../formula/adjust";
import { parse, type Ast } from "../formula/parser";
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

type Patch = RawPatch | StylePatch;

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
    const patches: Patch[] = [];
    for (const [key, style] of this.styles) {
      const { row, col } = parseKey(key);
      if (!rangeContains(range, row, col)) continue;
      patches.push({ kind: "style", row, col, before: style, after: null });
    }
    for (const p of patches) this.setStyleRecord(p.row, p.col, null);
    this.commitStylePatches(patches);
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
      } else {
        this.setStyleRecord(p.row, p.col, p[side]);
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
    default:
      return d === undefined ? String(v) : v.toFixed(d);
  }
}

/** Parse non-formula raw text into a value: number, boolean, or string. */
export function parseLiteral(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed !== "" && !isNaN(Number(trimmed))) return Number(trimmed);
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  return raw;
}
