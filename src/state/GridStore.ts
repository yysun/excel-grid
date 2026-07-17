// Central grid state store (framework-agnostic, consumed via useSyncExternalStore).
// Features: sparse cell map keyed "row,col"; literal parsing (numbers/booleans/
// text); formula parsing + incremental recalculation through a dependency
// graph with #CYCLE! detection; undo/redo as inverse patch batches; column
// widths; change notification with computed values.
// Recent changes: clearRange iterates occupied cells only; recompute uses a
// Set for touched-key exclusion.

import { FormulaError, type ErrorCode } from "../formula/errors";
import { evaluate, type EvalContext } from "../formula/evaluate";
import { extractRefs, hasRefError } from "../formula/adjust";
import { parse, type Ast } from "../formula/parser";
import type { CellData, CellRange, CellValue, GridChange } from "../types";
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

interface Patch {
  row: number;
  col: number;
  before: string | null;
  after: string | null;
}

export interface RawChange {
  row: number;
  col: number;
  raw: string | null;
}

export class GridStore {
  private cells = new Map<string, CellRecord>();
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

  /** Text shown in the cell. */
  getDisplay(row: number, col: number): string {
    const rec = this.cells.get(cellKey(row, col));
    if (!rec) return "";
    if (rec.error) return rec.error;
    if (rec.value === null) return "";
    if (typeof rec.value === "boolean") return rec.value ? "TRUE" : "FALSE";
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
      patches.push({ row: c.row, col: c.col, before, after });
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
      this.applyRaw(p.row, p.col, p[side]);
      touched.push(cellKey(p.row, p.col));
    }
    const recomputed = this.recompute(touched);
    this.notify(this.toGridChanges(new Set([...touched, ...recomputed])));
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

/** Parse non-formula raw text into a value: number, boolean, or string. */
export function parseLiteral(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed !== "" && !isNaN(Number(trimmed))) return Number(trimmed);
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  return raw;
}
