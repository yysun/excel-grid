// ExcelGrid: the Excel-Web-style spreadsheet component.
// Features: virtualized cells + sticky-style header strips, formula bar with
// name box, mouse/keyboard selection (cell, range, row/col via header drag,
// all), Excel-style navigation (hidden rows/cols and merges skipped/stepped
// as a unit), in-cell + formula-bar editing, formula recalculation via
// GridStore, TSV clipboard (native copy/cut/paste events + internal
// fallback), undo/redo shortcuts, column resize grips, fill handle with
// relative-reference adjustment, a WeCom-style formatting toolbar, per-cell
// CellStyle rendering (including per-side borders and font family),
// right-click context menus (cell / row header / column header) driving
// insert/delete/move/hide/freeze/sort/filter/clipboard/merge, merged-cell
// rendering and selection, a format-painter destination-click handler, and
// frozen panes rendered as transform-synced overlay panes.
// Recent changes: added merged-cell support — renderCells now draws one
// spanning block per merge (scanning store.getMerges() per pane call) and
// skips covered cells; selection splits into `rawSelRange` (the literal
// drag/selection, driving clipboard and all count-based structural menu
// actions) and merge-expanded `selRange` (driving rendering, Delete/
// Backspace, and Toolbar style actions), with `active` resolving to a
// merge's anchor and arrow-key `move()` stepping from a merge's far edge.
// Added cellStyleCss border/fontFamily rendering, a format-painter mouse
// handler in beginSelectDrag (arms via Toolbar, applies via drag-end,
// disarms on Escape), and initialState.merges seeding.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { adjustFormula } from "../formula/adjust";
import {
  filterValueKey,
  GridStore,
  type RawChange,
  type SortDir,
} from "../state/GridStore";
import type {
  BorderLineStyle,
  BorderSide,
  CellCoord,
  CellRange,
  CellStyle,
  ExcelGridHandle,
  ExcelGridProps,
  HAlign,
  VAlign,
} from "../types";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { FilterPopup } from "./FilterPopup";
import { Toolbar } from "./Toolbar";
import {
  cellKey,
  colToLetters,
  formatCellRef,
  normalizeRange,
  parseCellRef,
  parseRange,
  rangeContains,
  rangesIntersect,
} from "../utils/cellRef";
import { parseTSV, toTSV } from "../utils/tsv";
import { buildAxisMetrics, useVirtualRange } from "./useVirtualRange";
import { useSyncExternalStore } from "react";

const HEADER_HEIGHT = 24;
const ROW_HEADER_WIDTH = 46;
const CELL_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
/** Horizontal padding (both sides) reserved by .xg-cell in styles.css. */
const CELL_H_PADDING = 8;

let measureCtx: CanvasRenderingContext2D | null = null;

/** Approximate wrapped line count for `text` at `font` within `maxWidth`. */
function countWrappedLines(text: string, font: string, maxWidth: number): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx || maxWidth <= 0) return 1;
  measureCtx.font = font;
  let lines = 1;
  let lineWidth = 0;
  for (const word of text.split(/(\s+)/)) {
    if (word === "") continue;
    const isSpace = /^\s+$/.test(word);
    const w = measureCtx.measureText(word).width;
    if (!isSpace && w > maxWidth) {
      // Word (or spaceless CJK run) is wider than the cell: word-break:
      // break-word wraps it mid-character in the browser, so simulate
      // that here instead of treating it as one unbreakable unit.
      for (const ch of word) {
        const cw = measureCtx.measureText(ch).width;
        if (lineWidth > 0 && lineWidth + cw > maxWidth) {
          lines++;
          lineWidth = cw;
        } else {
          lineWidth += cw;
        }
      }
      continue;
    }
    if (lineWidth > 0 && lineWidth + w > maxWidth) {
      lines++;
      lineWidth = isSpace ? 0 : w;
    } else {
      lineWidth += w;
    }
  }
  return Math.max(1, lines);
}

interface Selection {
  anchor: CellCoord;
  focus: CellCoord;
}

interface EditorState {
  row: number;
  col: number;
  initial: string;
  /** Caret at end for F2/double-click; replace-all for type-to-edit. */
  selectAll: boolean;
}

interface InternalClipboard {
  tsv: string;
  source: CellRange;
  cut: boolean;
}

interface MenuState {
  x: number;
  y: number;
  zone: "cell" | "row" | "col";
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * Union `range` with every merge it intersects, repeatedly until stable.
 * Merges are always mutually disjoint (mergeCells replaces any it
 * overlaps), so a single pass over `merges` is always sufficient.
 */
function expandForMerges(range: CellRange, merges: CellRange[]): CellRange {
  let r = range;
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of merges) {
      if (!rangesIntersect(r, m)) continue;
      const next: CellRange = {
        startRow: Math.min(r.startRow, m.startRow),
        endRow: Math.max(r.endRow, m.endRow),
        startCol: Math.min(r.startCol, m.startCol),
        endCol: Math.max(r.endCol, m.endCol),
      };
      if (
        next.startRow !== r.startRow ||
        next.endRow !== r.endRow ||
        next.startCol !== r.startCol ||
        next.endCol !== r.endCol
      ) {
        r = next;
        grew = true;
      }
    }
  }
  return r;
}

export const ExcelGrid = forwardRef<ExcelGridHandle, ExcelGridProps>(
  function ExcelGrid(props, ref) {
    const {
      rows = 1000,
      cols = 26,
      initialCells,
      initialState,
      onChange,
      onStateChange,
      rowHeight = 24,
      defaultColWidth = 100,
      className,
      toolbar = true,
    } = props;

    const storeRef = useRef<GridStore | null>(null);
    if (storeRef.current === null) {
      const store = new GridStore(rows, cols, defaultColWidth, rowHeight);
      const seedCells = (source: Record<string, string>) => {
        const changes: RawChange[] = [];
        for (const [refText, raw] of Object.entries(source)) {
          const parsed = parseCellRef(refText);
          if (parsed) changes.push({ row: parsed.row, col: parsed.col, raw });
        }
        store.setCells(changes, false);
      };
      if (initialCells) seedCells(initialCells);
      // Full-state snapshot applies after initialCells; all of this runs
      // before the first render, so notify() reaches no subscribers yet.
      if (initialState) {
        // Tolerate partial snapshots (e.g. hand-edited or older persisted
        // JSON): a missing section means "none", never a crash.
        seedCells(initialState.cells ?? {});
        for (const [refText, style] of Object.entries(initialState.styles ?? {})) {
          const parsed = parseCellRef(refText);
          if (parsed) store.initStyle(parsed.row, parsed.col, style);
        }
        for (const [col, width] of Object.entries(initialState.colWidths ?? {})) {
          // JSON round-trips numeric keys as strings.
          if (typeof width === "number") store.setColWidth(Number(col), width);
        }
        for (const [row, height] of Object.entries(initialState.rowHeights ?? {})) {
          if (typeof height === "number") store.setRowHeight(Number(row), height);
        }
        const merges = (initialState.merges ?? [])
          .map(parseRange)
          .filter((r): r is CellRange => r !== null);
        store.initMerges(merges);
      }
      storeRef.current = store;
    }
    const store = storeRef.current;
    useEffect(() => {
      store.onChange = onChange ?? null;
    }, [store, onChange]);

    // Persistence signal: fires on every store notify, including
    // style-only and width-only edits that onChange does not report.
    const onStateChangeRef = useRef(onStateChange);
    onStateChangeRef.current = onStateChange;
    useEffect(
      () => store.subscribe(() => onStateChangeRef.current?.()),
      [store]
    );

    const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);

    const bodyRef = useRef<HTMLDivElement>(null);
    const [scroll, setScroll] = useState({ top: 0, left: 0 });
    const [viewport, setViewport] = useState({ width: 800, height: 600 });
    const [selection, setSelection] = useState<Selection>({
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 0 },
    });
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [fxDraft, setFxDraft] = useState<string | null>(null);
    const [fillPreview, setFillPreview] = useState<CellRange | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    /** Open column-filter popup (anchored under its header button). */
    const [filterPopup, setFilterPopup] = useState<{
      col: number;
      x: number;
      y: number;
    } | null>(null);
    // Stable identity: FilterPopup re-subscribes document listeners when
    // onClose changes, and ExcelGrid re-renders on every store notify.
    const closeFilterPopup = useCallback(() => setFilterPopup(null), []);
    const internalClipboard = useRef<InternalClipboard | null>(null);
    const pasteHandledAt = useRef(0);
    const editorRef = useRef<{ commit: () => void } | null>(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const colWidths = useMemo(
      () =>
        Array.from({ length: cols }, (_, i) =>
          store.isColHidden(i) ? 0 : store.getColWidth(i)
        ),
      [store, cols, version]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const rowHeights = useMemo(() => {
      const heights = Array.from({ length: rows }, (_, i) =>
        store.isRowHidden(i) ? 0 : store.getRowHeight(i)
      );
      // Auto-fit rows containing wrapped text that the user hasn't manually
      // resized (a drag-resize always wins, like Excel's own behavior).
      for (const { row, col } of store.getWrapCells()) {
        if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
        if (heights[row] === 0 || store.hasRowHeightOverride(row)) continue;
        const width = colWidths[col];
        if (width <= 0) continue;
        const text = store.getDisplay(row, col);
        if (!text) continue;
        const style = store.getStyle(row, col);
        const fontSize = style?.fontSize ?? 13;
        const font = `${style?.bold ? "600 " : ""}${fontSize}px ${CELL_FONT_STACK}`;
        const lines = countWrappedLines(text, font, width - CELL_H_PADDING);
        const needed = Math.ceil(lines * fontSize * 1.35) + 6;
        if (needed > heights[row]) heights[row] = needed;
      }
      return heights;
    }, [store, rows, cols, colWidths, version]);
    const colMetrics = useMemo(() => buildAxisMetrics(colWidths), [colWidths]);
    const rowMetrics = useMemo(() => buildAxisMetrics(rowHeights), [rowHeights]);

    const frozenRows = Math.min(store.getFrozenRows(), rows);
    const frozenCols = Math.min(store.getFrozenCols(), cols);
    const frozenH = rowMetrics.offsets[frozenRows];
    const frozenW = colMetrics.offsets[frozenCols];

    const win = useVirtualRange(
      scroll.top,
      scroll.left,
      viewport.width,
      viewport.height,
      rowMetrics,
      colMetrics
    );

    useEffect(() => {
      const body = bodyRef.current;
      if (!body) return;
      const ro = new ResizeObserver(() => {
        setViewport({ width: body.clientWidth, height: body.clientHeight });
      });
      ro.observe(body);
      return () => ro.disconnect();
    }, []);

    const merges = store.getMerges();

    // The literal dragged/selected range: drives clipboard and every
    // count-based structural menu action (insert/delete/move/hide/freeze/
    // sort rows or columns) so those never silently widen just because the
    // selection touches a merge.
    const rawSelRange = useMemo(
      () => normalizeRange(selection.anchor, selection.focus),
      [selection]
    );
    // Merge-expanded selection: drives rendering, Delete/Backspace,
    // Toolbar style actions, and format-painter's destination capture.
    const selRange = useMemo(
      () => expandForMerges(rawSelRange, merges),
      [rawSelRange, merges]
    );
    // The active cell, resolved to its merge's anchor when covered.
    const active = useMemo(() => {
      const m = store.getMergeAt(selection.anchor.row, selection.anchor.col);
      return m ? { row: m.startRow, col: m.startCol } : selection.anchor;
    }, [selection.anchor, store, version]);

    // ---- helpers ----

    const ensureVisible = useCallback(
      (coord: CellCoord) => {
        const body = bodyRef.current;
        if (!body) return;
        const x0 = colMetrics.offsets[coord.col];
        const x1 = colMetrics.offsets[coord.col + 1];
        const y0 = rowMetrics.offsets[coord.row];
        const y1 = rowMetrics.offsets[coord.row + 1];
        if (coord.col >= frozenCols) {
          if (x0 < body.scrollLeft + frozenW) body.scrollLeft = x0 - frozenW;
          else if (x1 > body.scrollLeft + body.clientWidth) {
            body.scrollLeft = x1 - body.clientWidth;
          }
        }
        if (coord.row >= frozenRows) {
          if (y0 < body.scrollTop + frozenH) body.scrollTop = y0 - frozenH;
          else if (y1 > body.scrollTop + body.clientHeight) {
            body.scrollTop = y1 - body.clientHeight;
          }
        }
      },
      [colMetrics, rowMetrics, frozenCols, frozenRows, frozenW, frozenH]
    );

    const setActive = useCallback(
      (coord: CellCoord, extend = false) => {
        const c = {
          row: clamp(coord.row, 0, rows - 1),
          col: clamp(coord.col, 0, cols - 1),
        };
        setSelection((s) =>
          extend ? { anchor: s.anchor, focus: c } : { anchor: c, focus: c }
        );
        setFxDraft(null);
        ensureVisible(c);
      },
      [rows, cols, ensureVisible]
    );

    const focusGrid = useCallback(() => {
      bodyRef.current?.focus({ preventScroll: true });
    }, []);

    const coordFromMouse = useCallback(
      (e: { clientX: number; clientY: number }): CellCoord => {
        const body = bodyRef.current!;
        const rect = body.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const relY = e.clientY - rect.top;
        const x = relX < frozenW ? relX : relX + body.scrollLeft;
        const y = relY < frozenH ? relY : relY + body.scrollTop;
        return {
          row: rowMetrics.indexAt(clamp(y, 0, rowMetrics.total - 1)),
          col: colMetrics.indexAt(clamp(x, 0, colMetrics.total - 1)),
        };
      },
      [colMetrics, rowMetrics, frozenW, frozenH]
    );

    /**
     * Move from `start` by `delta`, then skip hidden entries in the travel
     * direction (falling back toward the start when the edge is hidden).
     */
    const stepVisible = useCallback(
      (
        start: number,
        delta: number,
        count: number,
        isHidden: (i: number) => boolean
      ): number => {
        if (delta === 0) return start;
        const dir = delta > 0 ? 1 : -1;
        let t = clamp(start + delta, 0, count - 1);
        while (t >= 0 && t < count && isHidden(t)) t += dir;
        if (t < 0 || t >= count) {
          t = clamp(start + delta, 0, count - 1);
          while (t >= 0 && t < count && isHidden(t)) t -= dir;
          if (t < 0 || t >= count) return start;
        }
        return t;
      },
      []
    );

    const openEditor = useCallback(
      (row: number, col: number, initial: string, selectAll: boolean) => {
        setEditor({ row, col, initial, selectAll });
      },
      []
    );

    const commitEditor = useCallback(
      (raw: string, move?: "down" | "up" | "right" | "left") => {
        if (editor) {
          store.setCells([{ row: editor.row, col: editor.col, raw }]);
          const d = move
            ? { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[move]
            : [0, 0];
          setActive({ row: editor.row + d[0], col: editor.col + d[1] });
        }
        setEditor(null);
        focusGrid();
      },
      [editor, store, setActive, focusGrid]
    );

    const cancelEditor = useCallback(() => {
      setEditor(null);
      focusGrid();
    }, [focusGrid]);

    // ---- clipboard ----

    const buildTSV = useCallback((): { tsv: string; source: CellRange } => {
      const r = rawSelRange;
      const matrix: string[][] = [];
      for (let row = r.startRow; row <= r.endRow; row++) {
        const line: string[] = [];
        for (let col = r.startCol; col <= r.endCol; col++) {
          line.push(store.getRaw(row, col));
        }
        matrix.push(line);
      }
      return { tsv: toTSV(matrix), source: r };
    }, [rawSelRange, store]);

    const applyPaste = useCallback(
      (text: string) => {
        const internal = internalClipboard.current;
        const isInternal = internal !== null && internal.tsv === text;
        const matrix = parseTSV(text);
        if (matrix.length === 0) return;
        const target: CellCoord = { row: rawSelRange.startRow, col: rawSelRange.startCol };
        const changes: RawChange[] = [];
        const pastedKeys = new Set<string>();
        for (let r = 0; r < matrix.length; r++) {
          for (let c = 0; c < matrix[r].length; c++) {
            const row = target.row + r;
            const col = target.col + c;
            if (row >= rows || col >= cols) continue;
            let raw = matrix[r][c];
            if (isInternal && raw.startsWith("=")) {
              raw = adjustFormula(
                raw,
                row - (internal.source.startRow + r),
                col - (internal.source.startCol + c),
                rows,
                cols
              );
            }
            changes.push({ row, col, raw: raw === "" ? null : raw });
            pastedKeys.add(cellKey(row, col));
          }
        }
        if (isInternal && internal.cut) {
          for (
            let row = internal.source.startRow;
            row <= internal.source.endRow;
            row++
          ) {
            for (
              let col = internal.source.startCol;
              col <= internal.source.endCol;
              col++
            ) {
              if (!pastedKeys.has(cellKey(row, col))) {
                changes.push({ row, col, raw: null });
              }
            }
          }
          internalClipboard.current = { ...internal, cut: false };
        }
        store.setCells(changes);
        const endRow = clamp(target.row + matrix.length - 1, 0, rows - 1);
        const endCol = clamp(
          target.col + (matrix[0]?.length ?? 1) - 1,
          0,
          cols - 1
        );
        setSelection({ anchor: target, focus: { row: endRow, col: endCol } });
      },
      [rawSelRange, store, rows, cols]
    );

    /** Copy/cut the selection to the internal + async system clipboard. */
    const copySelection = useCallback(
      (cut: boolean) => {
        const { tsv, source } = buildTSV();
        internalClipboard.current = { tsv, source, cut };
        navigator.clipboard?.writeText(tsv).catch(() => {});
      },
      [buildTSV]
    );

    /**
     * Paste via the async clipboard API, falling back to the internal
     * clipboard. When `notBefore` is given, a native paste handled after
     * that timestamp wins and this call becomes a no-op.
     */
    const pasteFromSystemClipboard = useCallback(
      (notBefore?: number) => {
        void (async () => {
          if (notBefore !== undefined && pasteHandledAt.current >= notBefore) return;
          let text = "";
          try {
            text = await navigator.clipboard.readText();
          } catch {
            // Permission denied or API unavailable.
          }
          if (notBefore !== undefined && pasteHandledAt.current >= notBefore) return;
          if (!text && internalClipboard.current) {
            text = internalClipboard.current.tsv;
          }
          if (text) {
            pasteHandledAt.current = Date.now();
            applyPaste(text);
          }
        })();
      },
      [applyPaste]
    );

    const handleCopyCut = useCallback(
      (e: React.ClipboardEvent, cut: boolean) => {
        if (editor) return; // Let the editor's own copy/paste behave normally.
        const { tsv, source } = buildTSV();
        internalClipboard.current = { tsv, source, cut };
        e.clipboardData.setData("text/plain", tsv);
        e.preventDefault();
      },
      [editor, buildTSV]
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        if (editor) return;
        pasteHandledAt.current = Date.now();
        const text = e.clipboardData.getData("text/plain");
        e.preventDefault();
        if (text) applyPaste(text);
        else if (internalClipboard.current) {
          applyPaste(internalClipboard.current.tsv);
        }
      },
      [editor, applyPaste]
    );

    // ---- keyboard ----

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (editor) return; // The editor input handles its own keys.
        const mod = e.metaKey || e.ctrlKey;
        const { row, col } = active;
        const isRowHidden = (i: number) => store.isRowHidden(i);
        const isColHidden = (i: number) => store.isColHidden(i);
        const move = (dr: number, dc: number, extend = false) => {
          e.preventDefault();
          const base = extend ? selection.focus : active;
          // Step from the far edge of base's merge (if any) in the travel
          // direction, so leaving a multi-row/col merge advances exactly
          // one line past it instead of possibly landing on another cell
          // still inside the same merge (which would resolve right back to
          // the same anchor).
          const m = store.getMergeAt(base.row, base.col);
          const fromRow = m ? (dr > 0 ? m.endRow : dr < 0 ? m.startRow : base.row) : base.row;
          const fromCol = m ? (dc > 0 ? m.endCol : dc < 0 ? m.startCol : base.col) : base.col;
          setActive(
            {
              row: dr === 0 ? base.row : stepVisible(fromRow, dr, rows, isRowHidden),
              col: dc === 0 ? base.col : stepVisible(fromCol, dc, cols, isColHidden),
            },
            extend
          );
        };
        switch (e.key) {
          case "ArrowUp":
            return move(-1, 0, e.shiftKey);
          case "ArrowDown":
            return move(1, 0, e.shiftKey);
          case "ArrowLeft":
            return move(0, -1, e.shiftKey);
          case "ArrowRight":
            return move(0, 1, e.shiftKey);
          case "Tab":
            return move(0, e.shiftKey ? -1 : 1);
          case "Enter":
            return move(e.shiftKey ? -1 : 1, 0);
          case "Home": {
            e.preventDefault();
            const firstCol = stepVisible(-1, 1, cols, isColHidden);
            return setActive(
              mod
                ? { row: stepVisible(-1, 1, rows, isRowHidden), col: firstCol }
                : { row, col: firstCol }
            );
          }
          case "PageDown":
            return move(Math.max(1, Math.floor(viewport.height / rowHeight)), 0, e.shiftKey);
          case "PageUp":
            return move(-Math.max(1, Math.floor(viewport.height / rowHeight)), 0, e.shiftKey);
          case "F2":
            e.preventDefault();
            return openEditor(row, col, store.getRaw(row, col), false);
          case "Delete":
          case "Backspace":
            e.preventDefault();
            return store.clearRange(selRange);
          case "Escape":
            internalClipboard.current = null;
            if (store.isFormatPainterArmed()) store.disarmFormatPainter();
            return;
        }
        if (mod) {
          const k = e.key.toLowerCase();
          if (k === "a") {
            e.preventDefault();
            setSelection({
              anchor: { row: 0, col: 0 },
              focus: { row: rows - 1, col: cols - 1 },
            });
            return;
          }
          if (k === "z") {
            e.preventDefault();
            if (e.shiftKey) store.redo();
            else store.undo();
            return;
          }
          if (k === "y") {
            e.preventDefault();
            store.redo();
            return;
          }
          if (k === "c" || k === "x") {
            // Native copy/cut events follow and set the system clipboard; the
            // internal clipboard + async API cover environments where they
            // don't fire.
            copySelection(k === "x");
            return;
          }
          if (k === "v") {
            // Native paste event should follow; fall back to the async
            // Clipboard API, then the internal clipboard, when it doesn't.
            const at = Date.now();
            setTimeout(() => pasteFromSystemClipboard(at), 120);
            return;
          }
          return;
        }
        // Type-to-edit: printable character replaces the cell content.
        if (e.key.length === 1 && !e.altKey) {
          e.preventDefault();
          openEditor(row, col, e.key, false);
        }
      },
      [
        editor,
        active,
        selection.focus,
        selRange,
        setActive,
        stepVisible,
        openEditor,
        store,
        rows,
        cols,
        viewport.height,
        rowHeight,
        copySelection,
        pasteFromSystemClipboard,
      ]
    );

    // ---- mouse ----

    const beginSelectDrag = useCallback(
      (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        if (editor) editorRef.current?.commit();
        const start = coordFromMouse(e);
        setActive(start, e.shiftKey);
        const onMove = (ev: MouseEvent) => {
          const c = coordFromMouse(ev);
          setSelection((s) => ({ anchor: s.anchor, focus: c }));
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          // Read the armed source and the just-settled selection fresh here
          // (not captured earlier in the drag) — store is a stable ref, so
          // this reads its current state, not a stale closure.
          if (store.isFormatPainterArmed()) {
            const source = store.getFormatPainterSource()!;
            const style = store.getStyle(source.startRow, source.startCol);
            setSelection((s) => {
              const dest = expandForMerges(
                normalizeRange(s.anchor, s.focus),
                store.getMerges()
              );
              store.replaceStyle(dest, style);
              return s;
            });
            store.disarmFormatPainter();
          }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      [editor, coordFromMouse, setActive, store]
    );

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        const c = coordFromMouse(e);
        const m = store.getMergeAt(c.row, c.col);
        const anchor = m ? { row: m.startRow, col: m.startCol } : c;
        openEditor(anchor.row, anchor.col, store.getRaw(anchor.row, anchor.col), false);
      },
      [coordFromMouse, openEditor, store]
    );

    const beginFillDrag = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const source = selRange;
        const onMove = (ev: MouseEvent) => {
          const c = coordFromMouse(ev);
          const downSpan = Math.max(0, c.row - source.endRow);
          const rightSpan = Math.max(0, c.col - source.endCol);
          if (downSpan >= rightSpan && downSpan > 0) {
            setFillPreview({ ...source, endRow: c.row });
          } else if (rightSpan > 0) {
            setFillPreview({ ...source, endCol: c.col });
          } else {
            setFillPreview(null);
          }
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          setFillPreview((preview) => {
            if (preview) {
              const srcH = source.endRow - source.startRow + 1;
              const srcW = source.endCol - source.startCol + 1;
              const changes: RawChange[] = [];
              for (let row = preview.startRow; row <= preview.endRow; row++) {
                for (let col = preview.startCol; col <= preview.endCol; col++) {
                  if (rangeContains(source, row, col)) continue;
                  const srcRow =
                    source.startRow + (((row - source.startRow) % srcH) + srcH) % srcH;
                  const srcCol =
                    source.startCol + (((col - source.startCol) % srcW) + srcW) % srcW;
                  let raw: string | null = store.getRaw(srcRow, srcCol);
                  if (raw === "") raw = null;
                  else if (raw.startsWith("=")) {
                    raw = adjustFormula(raw, row - srcRow, col - srcCol, rows, cols);
                  }
                  changes.push({ row, col, raw });
                }
              }
              store.setCells(changes);
              setSelection({
                anchor: { row: preview.startRow, col: preview.startCol },
                focus: { row: preview.endRow, col: preview.endCol },
              });
            }
            return null;
          });
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      [selRange, coordFromMouse, store, rows, cols]
    );

    const beginResizeDrag = useCallback(
      (e: React.MouseEvent, col: number) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = store.getColWidth(col);
        const onMove = (ev: MouseEvent) => {
          store.setColWidth(col, startWidth + (ev.clientX - startX));
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      [store]
    );

    const beginRowResizeDrag = useCallback(
      (e: React.MouseEvent, row: number) => {
        e.stopPropagation();
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = store.getRowHeight(row);
        const onMove = (ev: MouseEvent) => {
          store.setRowHeight(row, startHeight + (ev.clientY - startY));
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      [store]
    );

    const selectColumn = useCallback(
      (col: number) => {
        setSelection({
          anchor: { row: 0, col },
          focus: { row: rows - 1, col },
        });
        setFxDraft(null);
        focusGrid();
      },
      [rows, focusGrid]
    );

    const selectRow = useCallback(
      (row: number) => {
        setSelection({
          anchor: { row, col: 0 },
          focus: { row, col: cols - 1 },
        });
        setFxDraft(null);
        focusGrid();
      },
      [cols, focusGrid]
    );

    /** Full-line selection with drag-extend and shift-click, from a header. */
    const beginHeaderDrag = useCallback(
      (axis: "row" | "col", index: number, shiftKey: boolean) => {
        setSelection((s) => {
          const anchorIdx = shiftKey
            ? axis === "row"
              ? s.anchor.row
              : s.anchor.col
            : index;
          return axis === "row"
            ? {
                anchor: { row: anchorIdx, col: 0 },
                focus: { row: index, col: cols - 1 },
              }
            : {
                anchor: { row: 0, col: anchorIdx },
                focus: { row: rows - 1, col: index },
              };
        });
        setFxDraft(null);
        focusGrid();
        const onMove = (ev: MouseEvent) => {
          const c = coordFromMouse(ev);
          setSelection((s) =>
            axis === "row"
              ? { anchor: s.anchor, focus: { row: c.row, col: cols - 1 } }
              : { anchor: s.anchor, focus: { row: rows - 1, col: c.col } }
          );
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      [rows, cols, focusGrid, coordFromMouse]
    );

    // ---- context menu ----

    const closeMenu = useCallback(() => {
      setMenu(null);
      // The menu button held focus; return it so keyboard shortcuts work.
      focusGrid();
    }, [focusGrid]);

    const handleCellContextMenu = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        if (editor) editorRef.current?.commit();
        const c = coordFromMouse(e);
        if (!rangeContains(selRange, c.row, c.col)) {
          // Select directly (no ensureVisible): the cell is already under
          // the cursor, and scrolling now would close the menu on open.
          setSelection({ anchor: c, focus: c });
          setFxDraft(null);
        }
        focusGrid();
        setMenu({ x: e.clientX, y: e.clientY, zone: "cell" });
      },
      [editor, coordFromMouse, selRange, focusGrid]
    );

    const handleHeaderContextMenu = useCallback(
      (axis: "row" | "col", index: number, e: React.MouseEvent) => {
        e.preventDefault();
        if (editor) editorRef.current?.commit();
        const fullSpan =
          axis === "row"
            ? rawSelRange.startCol === 0 && rawSelRange.endCol === cols - 1
            : rawSelRange.startRow === 0 && rawSelRange.endRow === rows - 1;
        const inside =
          axis === "row"
            ? index >= rawSelRange.startRow && index <= rawSelRange.endRow
            : index >= rawSelRange.startCol && index <= rawSelRange.endCol;
        if (!(fullSpan && inside)) {
          if (axis === "row") selectRow(index);
          else selectColumn(index);
        }
        setMenu({ x: e.clientX, y: e.clientY, zone: axis });
      },
      [editor, rawSelRange, rows, cols, selectRow, selectColumn]
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const menuItems = useMemo((): MenuItem[] => {
      if (!menu) return [];
      const r = rawSelRange;
      const clipboardItems: MenuItem[] = [
        { label: "Cut", onClick: () => copySelection(true) },
        { label: "Copy", onClick: () => copySelection(false) },
        { label: "Paste", onClick: () => pasteFromSystemClipboard() },
      ];
      if (menu.zone === "row") {
        const n = r.endRow - r.startRow + 1;
        const word = n === 1 ? "row" : `${n} rows`;
        return [
          ...clipboardItems,
          "sep",
          { label: `Insert ${word} above`, onClick: () => store.insertRows(r.startRow, n) },
          { label: `Insert ${word} below`, onClick: () => store.insertRows(r.endRow + 1, n) },
          { label: `Delete ${word}`, onClick: () => store.deleteRows(r.startRow, r.endRow) },
          "sep",
          {
            label: `Move ${word} up`,
            disabled: r.startRow === 0,
            onClick: () => store.moveRows(r.startRow, r.endRow, -1),
          },
          {
            label: `Move ${word} down`,
            disabled: r.endRow === rows - 1,
            onClick: () => store.moveRows(r.startRow, r.endRow, 1),
          },
          "sep",
          { label: `Hide ${word}`, onClick: () => store.setRowsHidden(r.startRow, r.endRow, true) },
          {
            label: "Unhide rows",
            disabled: !store.hasHiddenRowsIn(r.startRow, r.endRow),
            onClick: () => store.setRowsHidden(r.startRow, r.endRow, false),
          },
          "sep",
          { label: `Freeze up to row ${r.endRow + 1}`, onClick: () => store.setFrozenRows(r.endRow + 1) },
          {
            label: "Unfreeze rows",
            disabled: store.getFrozenRows() === 0,
            onClick: () => store.setFrozenRows(0),
          },
        ];
      }
      if (menu.zone === "col") {
        const n = r.endCol - r.startCol + 1;
        const word = n === 1 ? "column" : `${n} columns`;
        const keyLetter = colToLetters(r.startCol);
        const hasData = store.getUsedRange() !== null;
        const sortSheet = (dir: "asc" | "desc") => {
          const used = store.getUsedRange();
          if (used) store.sortRange(used, r.startCol, dir);
        };
        return [
          ...clipboardItems,
          "sep",
          { label: `Insert ${word} left`, onClick: () => store.insertCols(r.startCol, n) },
          { label: `Insert ${word} right`, onClick: () => store.insertCols(r.endCol + 1, n) },
          { label: `Delete ${word}`, onClick: () => store.deleteCols(r.startCol, r.endCol) },
          "sep",
          {
            label: `Move ${word} left`,
            disabled: r.startCol === 0,
            onClick: () => store.moveCols(r.startCol, r.endCol, -1),
          },
          {
            label: `Move ${word} right`,
            disabled: r.endCol === cols - 1,
            onClick: () => store.moveCols(r.startCol, r.endCol, 1),
          },
          "sep",
          { label: `Hide ${word}`, onClick: () => store.setColsHidden(r.startCol, r.endCol, true) },
          {
            label: "Unhide columns",
            disabled: !store.hasHiddenColsIn(r.startCol, r.endCol),
            onClick: () => store.setColsHidden(r.startCol, r.endCol, false),
          },
          "sep",
          {
            label: `Freeze up to column ${colToLetters(r.endCol)}`,
            onClick: () => store.setFrozenCols(r.endCol + 1),
          },
          {
            label: "Unfreeze columns",
            disabled: store.getFrozenCols() === 0,
            onClick: () => store.setFrozenCols(0),
          },
          "sep",
          {
            label: `Sort sheet A→Z by ${keyLetter}`,
            disabled: !hasData,
            onClick: () => sortSheet("asc"),
          },
          {
            label: `Sort sheet Z→A by ${keyLetter}`,
            disabled: !hasData,
            onClick: () => sortSheet("desc"),
          },
        ];
      }
      const nR = r.endRow - r.startRow + 1;
      const nC = r.endCol - r.startCol + 1;
      const rowWord = nR === 1 ? "row" : `${nR} rows`;
      const colWord = nC === 1 ? "column" : `${nC} columns`;
      const activeMerge = store.getMergeAt(active.row, active.col);
      return [
        ...clipboardItems,
        "sep",
        { label: `Insert ${rowWord} above`, onClick: () => store.insertRows(r.startRow, nR) },
        { label: `Insert ${colWord} left`, onClick: () => store.insertCols(r.startCol, nC) },
        { label: `Delete ${rowWord}`, onClick: () => store.deleteRows(r.startRow, r.endRow) },
        { label: `Delete ${colWord}`, onClick: () => store.deleteCols(r.startCol, r.endCol) },
        "sep",
        {
          label: activeMerge ? "Unmerge cells" : "Merge cells",
          disabled: !activeMerge && nR * nC < 2,
          onClick: () =>
            activeMerge ? store.unmergeCells(activeMerge) : store.mergeCells(r),
        },
        "sep",
        {
          label: "Sort range A→Z",
          disabled: r.startRow === r.endRow,
          onClick: () => store.sortRange(r, r.startCol, "asc"),
        },
        {
          label: "Sort range Z→A",
          disabled: r.startRow === r.endRow,
          onClick: () => store.sortRange(r, r.startCol, "desc"),
        },
        "sep",
        {
          label: "Filter by cell value",
          onClick: () =>
            store.setColFilter(
              active.col,
              new Set([
                filterValueKey(store.getCell(active.row, active.col)?.value ?? null),
              ])
            ),
        },
        {
          label: "Clear filter",
          disabled: !store.hasActiveFilters(),
          onClick: () => store.clearColFilters(),
        },
      ];
    }, [
      menu,
      rawSelRange,
      active,
      store,
      rows,
      cols,
      copySelection,
      pasteFromSystemClipboard,
      version,
    ]);

    // ---- imperative API ----

    useImperativeHandle(
      ref,
      (): ExcelGridHandle => ({
        getCell: (refText) => {
          const parsed = parseCellRef(refText);
          return parsed ? store.getCell(parsed.row, parsed.col) : null;
        },
        setCell: (refText, raw) => {
          const parsed = parseCellRef(refText);
          if (parsed) store.setCells([{ row: parsed.row, col: parsed.col, raw }]);
        },
        getData: () =>
          store
            .getAllCells()
            .map(({ row, col, raw, value, display }) => ({
              ref: formatCellRef(row, col),
              raw,
              value,
              display,
            })),
        getSnapshot: () => store.getSnapshot(),
      }),
      [store]
    );

    // ---- rendering ----

    // Trimmed to match GridStore's own recomputeSearch matching, so
    // highlighted spans line up exactly with isCellMatched.
    const searchQuery = store.getSearchQuery().trim();

    /** Build one cell's rendered div; shared by the normal loop and merge blocks. */
    const buildCellNode = (
      row: number,
      col: number,
      left: number,
      top: number,
      width: number,
      height: number,
      extraClass: string
    ): React.ReactNode => {
      const display = store.getDisplay(row, col);
      const cell = display === "" ? null : store.getCell(row, col);
      const isNum =
        cell !== null && !cell.error && typeof cell.value === "number";
      const cs = store.getStyle(row, col);
      const content =
        display !== "" && searchQuery && store.isCellMatched(row, col)
          ? highlightMatches(display, searchQuery)
          : display;
      return (
        <div
          key={cellKey(row, col)}
          className={
            "xg-cell" +
            extraClass +
            (isNum ? " xg-cell--num" : "") +
            (cell?.error ? " xg-cell--err" : "")
          }
          style={{
            left,
            top,
            width,
            height,
            ...(cs ? cellStyleCss(cs) : null),
          }}
        >
          {content}
        </div>
      );
    };

    const renderCells = (
      r0: number,
      r1: number,
      c0: number,
      c1: number
    ): React.ReactNode[] => {
      const out: React.ReactNode[] = [];
      // Render merges intersecting this pane's sub-rect first (scanning the
      // full merges list, not just anchors inside [r0,r1]x[c0,c1] — a
      // merge's anchor can scroll out of the virtualized window while the
      // rest of the block is still visible), tracking every covered
      // coordinate so the normal per-cell loop below skips them.
      const covered = new Set<string>();
      for (const m of merges) {
        if (m.endRow < r0 || m.startRow > r1 || m.endCol < c0 || m.startCol > c1) {
          continue;
        }
        out.push(
          buildCellNode(
            m.startRow,
            m.startCol,
            colMetrics.offsets[m.startCol],
            rowMetrics.offsets[m.startRow],
            colMetrics.offsets[m.endCol + 1] - colMetrics.offsets[m.startCol],
            rowMetrics.offsets[m.endRow + 1] - rowMetrics.offsets[m.startRow],
            " xg-cell--merged"
          )
        );
        for (let row = Math.max(0, m.startRow); row <= Math.min(rows - 1, m.endRow); row++) {
          for (let col = Math.max(0, m.startCol); col <= Math.min(cols - 1, m.endCol); col++) {
            covered.add(cellKey(row, col));
          }
        }
      }
      for (let row = r0; row <= r1; row++) {
        if (rowHeights[row] === 0) continue;
        for (let col = c0; col <= c1; col++) {
          if (colWidths[col] === 0) continue;
          if (covered.has(cellKey(row, col))) continue;
          out.push(
            buildCellNode(
              row,
              col,
              colMetrics.offsets[col],
              rowMetrics.offsets[row],
              colWidths[col],
              rowHeights[row],
              ""
            )
          );
        }
      }
      return out;
    };

    // Last sort direction per column header button; a fresh column sorts
    // ascending, a repeat click toggles. UI nicety only — not sheet state.
    const headerSortDirRef = useRef(new Map<number, SortDir>());

    const headerSort = (col: number) => {
      const used = store.getUsedRange();
      if (!used || used.startRow === used.endRow) return;
      const dir: SortDir =
        headerSortDirRef.current.get(col) === "asc" ? "desc" : "asc";
      headerSortDirRef.current.set(col, dir);
      store.sortRange(used, col, dir);
    };

    const colHeaderCell = (col: number): React.ReactNode => {
      if (colWidths[col] === 0) return null;
      const inSel = col >= selRange.startCol && col <= selRange.endCol;
      const hasFilterBtn = store.isFilterCol(col);
      return (
        <div
          key={col}
          className={
            "xg-header-cell" +
            (inSel ? " xg-header-cell--sel" : "") +
            (hasFilterBtn ? " xg-header-cell--filter" : "")
          }
          style={{
            left: colMetrics.offsets[col],
            top: 0,
            width: colWidths[col],
            height: HEADER_HEIGHT,
          }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.preventDefault(); // Keep keyboard focus on the grid body.
              beginHeaderDrag("col", col, e.shiftKey);
            }
          }}
          onContextMenu={(e) => handleHeaderContextMenu("col", col, e)}
        >
          {colToLetters(col)}
          <button
            type="button"
            className="xg-header-sort"
            title={`Sort by column ${colToLetters(col)}`}
            onMouseDown={(e) => {
              e.preventDefault(); // Keep keyboard focus on the grid body.
              e.stopPropagation(); // Don't start the column-select drag.
            }}
            onClick={() => headerSort(col)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path
                d="M3 4 5 2l2 2M3 6l2 2 2-2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {hasFilterBtn && (
            <button
              type="button"
              className={
                "xg-header-filter" +
                (store.hasActiveColFilter(col) ? " xg-header-filter--on" : "")
              }
              title={`Filter column ${colToLetters(col)}`}
              onMouseDown={(e) => {
                e.preventDefault(); // Keep keyboard focus on the grid body.
                e.stopPropagation(); // Don't start the column-select drag.
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setFilterPopup((p) =>
                  p?.col === col
                    ? null
                    : { col, x: rect.left, y: rect.bottom + 2 }
                );
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path
                  d="M1.5 2h7L6 5.4v2.8L4 7.3V5.4L1.5 2Z"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                  fill={store.hasActiveColFilter(col) ? "currentColor" : "none"}
                />
              </svg>
            </button>
          )}
          <div
            className="xg-resize-grip"
            onMouseDown={(e) => beginResizeDrag(e, col)}
          />
        </div>
      );
    };

    const rowHeaderCell = (row: number): React.ReactNode => {
      if (rowHeights[row] === 0) return null;
      const inSel = row >= selRange.startRow && row <= selRange.endRow;
      return (
        <div
          key={row}
          className={"xg-header-cell" + (inSel ? " xg-header-cell--sel" : "")}
          style={{
            left: 0,
            top: rowMetrics.offsets[row],
            width: ROW_HEADER_WIDTH,
            height: rowHeights[row],
          }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.preventDefault(); // Keep keyboard focus on the grid body.
              beginHeaderDrag("row", row, e.shiftKey);
            }
          }}
          onContextMenu={(e) => handleHeaderContextMenu("row", row, e)}
        >
          {row + 1}
          <div
            className="xg-resize-grip xg-resize-grip--row"
            onMouseDown={(e) => beginRowResizeDrag(e, row)}
          />
        </div>
      );
    };

    const colHeaders: React.ReactNode[] = [];
    for (let col = win.colStart; col <= win.colEnd; col++) {
      colHeaders.push(colHeaderCell(col));
    }
    const rowHeaders: React.ReactNode[] = [];
    for (let row = win.rowStart; row <= win.rowEnd; row++) {
      rowHeaders.push(rowHeaderCell(row));
    }
    const frozenColHeaders: React.ReactNode[] = [];
    for (let col = 0; col < frozenCols; col++) {
      frozenColHeaders.push(colHeaderCell(col));
    }
    const frozenRowHeaders: React.ReactNode[] = [];
    for (let row = 0; row < frozenRows; row++) {
      frozenRowHeaders.push(rowHeaderCell(row));
    }

    const rectForRange = (r: CellRange) => ({
      left: colMetrics.offsets[r.startCol],
      top: rowMetrics.offsets[r.startRow],
      width: colMetrics.offsets[r.endCol + 1] - colMetrics.offsets[r.startCol],
      height: rowMetrics.offsets[r.endRow + 1] - rowMetrics.offsets[r.startRow],
    });

    const selRect = rectForRange(selRange);
    const activeRect = rectForRange(
      store.getMergeAt(active.row, active.col) ?? normalizeRange(active, active)
    );
    const isMultiCell =
      selRange.startRow !== selRange.endRow || selRange.startCol !== selRange.endCol;

    const overlays = (withFillPreview: boolean): React.ReactNode => (
      <>
        {isMultiCell && <div className="xg-selection" style={selRect} />}
        <div className="xg-active" style={activeRect} />
        {withFillPreview && fillPreview && (
          <div className="xg-fill-preview" style={rectForRange(fillPreview)} />
        )}
      </>
    );

    const paneHandlers = {
      onMouseDown: beginSelectDrag,
      onDoubleClick: handleDoubleClick,
      onContextMenu: handleCellContextMenu,
    };

    const activeRaw = store.getRaw(active.row, active.col);

    return (
      <div
        className={"xg-root" + (className ? " " + className : "")}
        onCopy={(e) => handleCopyCut(e, false)}
        onCut={(e) => handleCopyCut(e, true)}
        onPaste={handlePaste}
      >
        {toolbar && (
          <Toolbar
            store={store}
            selRange={selRange}
            rawSelRange={rawSelRange}
            active={active}
            rows={rows}
          />
        )}
        <div className="xg-formula-bar">
          <div className="xg-name-box">{formatCellRef(active.row, active.col)}</div>
          <div className="xg-fx-label">fx</div>
          <input
            className="xg-fx-input"
            value={fxDraft ?? activeRaw}
            onChange={(e) => setFxDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (fxDraft !== null) {
                  store.setCells([
                    { row: active.row, col: active.col, raw: fxDraft },
                  ]);
                  setFxDraft(null);
                }
                setActive({ row: active.row + 1, col: active.col });
                focusGrid();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setFxDraft(null);
                focusGrid();
              }
            }}
          />
        </div>
        <div
          className="xg-layout"
          style={{
            gridTemplateColumns: `${ROW_HEADER_WIDTH}px 1fr`,
            gridTemplateRows: `${HEADER_HEIGHT}px 1fr`,
          }}
        >
          <div
            className="xg-corner"
            onMouseDown={(e) => {
              if (e.button === 0) {
                e.preventDefault(); // Keep keyboard focus on the grid body.
                setSelection({
                  anchor: { row: 0, col: 0 },
                  focus: { row: rows - 1, col: cols - 1 },
                });
                focusGrid();
              }
            }}
          />
          <div className="xg-colheaders">
            <div
              className="xg-header-inner"
              style={{
                transform: `translateX(${-scroll.left}px)`,
                width: colMetrics.total,
              }}
            >
              {colHeaders}
            </div>
            {frozenW > 0 && (
              <div
                className="xg-header-frozen"
                style={{ width: frozenW, height: HEADER_HEIGHT }}
              >
                {frozenColHeaders}
              </div>
            )}
          </div>
          <div className="xg-rowheaders">
            <div
              className="xg-header-inner"
              style={{
                transform: `translateY(${-scroll.top}px)`,
                height: rowMetrics.total,
              }}
            >
              {rowHeaders}
            </div>
            {frozenH > 0 && (
              <div
                className="xg-header-frozen"
                style={{ width: ROW_HEADER_WIDTH, height: frozenH }}
              >
                {frozenRowHeaders}
              </div>
            )}
          </div>
          <div className="xg-bodywrap">
            <div
              ref={bodyRef}
              className={
                "xg-body" +
                (store.isFormatPainterArmed() ? " xg-body--painting" : "")
              }
              tabIndex={0}
              onScroll={(e) => {
                const t = e.currentTarget;
                setScroll({ top: t.scrollTop, left: t.scrollLeft });
              }}
              onKeyDown={handleKeyDown}
              {...paneHandlers}
            >
              <div
                className="xg-spacer"
                style={{ width: colMetrics.total, height: rowMetrics.total }}
              />
              {renderCells(win.rowStart, win.rowEnd, win.colStart, win.colEnd)}
              {overlays(true)}
              {!editor && (
                <div
                  className="xg-fill-handle"
                  style={{
                    left: selRect.left + selRect.width - 3,
                    top: selRect.top + selRect.height - 3,
                  }}
                  onMouseDown={beginFillDrag}
                />
              )}
            </div>
            {frozenH > 0 && (
              <div
                className="xg-pane xg-pane--top"
                style={{ top: 0, left: 0, right: 0, height: frozenH }}
                {...paneHandlers}
              >
                <div
                  className="xg-pane-inner"
                  style={{
                    transform: `translateX(${-scroll.left}px)`,
                    width: colMetrics.total,
                    height: frozenH,
                  }}
                >
                  {renderCells(0, frozenRows - 1, win.colStart, win.colEnd)}
                  {overlays(false)}
                </div>
              </div>
            )}
            {frozenW > 0 && (
              <div
                className="xg-pane xg-pane--left"
                style={{ top: 0, left: 0, bottom: 0, width: frozenW }}
                {...paneHandlers}
              >
                <div
                  className="xg-pane-inner"
                  style={{
                    transform: `translateY(${-scroll.top}px)`,
                    width: frozenW,
                    height: rowMetrics.total,
                  }}
                >
                  {renderCells(win.rowStart, win.rowEnd, 0, frozenCols - 1)}
                  {overlays(false)}
                </div>
              </div>
            )}
            {frozenH > 0 && frozenW > 0 && (
              <div
                className="xg-pane xg-pane--corner"
                style={{ top: 0, left: 0, width: frozenW, height: frozenH }}
                {...paneHandlers}
              >
                <div
                  className="xg-pane-inner"
                  style={{ width: frozenW, height: frozenH }}
                >
                  {renderCells(0, frozenRows - 1, 0, frozenCols - 1)}
                  {overlays(false)}
                </div>
              </div>
            )}
            {editor && (
              <CellEditor
                key={cellKey(editor.row, editor.col)}
                editor={editor}
                left={
                  colMetrics.offsets[editor.col] -
                  (editor.col < frozenCols ? 0 : scroll.left)
                }
                top={
                  rowMetrics.offsets[editor.row] -
                  (editor.row < frozenRows ? 0 : scroll.top)
                }
                width={colWidths[editor.col]}
                height={rowHeights[editor.row] || rowHeight}
                onCommit={commitEditor}
                onCancel={cancelEditor}
                apiRef={editorRef}
              />
            )}
          </div>
        </div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onClose={closeMenu}
          />
        )}
        {filterPopup && (
          <FilterPopup
            key={filterPopup.col}
            store={store}
            col={filterPopup.col}
            x={filterPopup.x}
            y={filterPopup.y}
            onClose={closeFilterPopup}
          />
        )}
      </div>
    );
  }
);

const JUSTIFY: Record<HAlign, React.CSSProperties["justifyContent"]> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

const ALIGN_ITEMS: Record<VAlign, React.CSSProperties["alignItems"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

const BORDER_WIDTH: Record<BorderLineStyle, number> = {
  thin: 1,
  medium: 2,
  thick: 3,
};

/** CSS shorthand for one border side, or undefined to fall through to the
 * default gridline (`.xg-cell`'s own border-right/border-bottom). */
function borderSideCss(side: BorderSide | undefined): string | undefined {
  if (!side) return undefined;
  return `${BORDER_WIDTH[side.style]}px solid ${side.color ?? "#000000"}`;
}

/** Inline CSS for a cell's CellStyle (merged after positional styles). */
function cellStyleCss(cs: CellStyle): React.CSSProperties {
  const deco = [cs.underline && "underline", cs.strike && "line-through"]
    .filter(Boolean)
    .join(" ");
  return {
    fontWeight: cs.bold ? 600 : undefined,
    fontStyle: cs.italic ? "italic" : undefined,
    textDecoration: deco || undefined,
    fontSize: cs.fontSize,
    fontFamily: cs.fontFamily,
    color: cs.color,
    background: cs.background,
    justifyContent: cs.align ? JUSTIFY[cs.align] : undefined,
    // textAlign too: justifyContent cannot place the line boxes of wrapped
    // text, only the (full-width) anonymous flex item.
    textAlign: cs.align,
    alignItems: cs.valign ? ALIGN_ITEMS[cs.valign] : undefined,
    whiteSpace: cs.wrap ? "normal" : undefined,
    wordBreak: cs.wrap ? "break-word" : undefined,
    borderTop: borderSideCss(cs.border?.top),
    borderRight: borderSideCss(cs.border?.right),
    borderBottom: borderSideCss(cs.border?.bottom),
    borderLeft: borderSideCss(cs.border?.left),
  };
}

/**
 * Split `text` on every case-insensitive occurrence of `query`, wrapping
 * matches in a <mark> so the search box's live query is visible in place.
 */
function highlightMatches(text: string, query: string): React.ReactNode {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(needle, i);
  let key = 0;
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="xg-search-hit">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    i = idx + needle.length;
    idx = lower.indexOf(needle, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

interface CellEditorProps {
  editor: EditorState;
  left: number;
  top: number;
  width: number;
  height: number;
  onCommit: (raw: string, move?: "down" | "up" | "right" | "left") => void;
  onCancel: () => void;
  apiRef: React.MutableRefObject<{ commit: () => void } | null>;
}

function CellEditor({
  editor,
  left,
  top,
  width,
  height,
  onCommit,
  onCancel,
  apiRef,
}: CellEditorProps) {
  const [value, setValue] = useState(editor.initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const closedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (editor.selectAll) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }, [editor.selectAll]);

  useEffect(() => {
    apiRef.current = {
      commit: () => {
        if (!closedRef.current) {
          closedRef.current = true;
          onCommit(valueRef.current);
        }
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, onCommit]);

  const close = (fn: () => void) => {
    if (closedRef.current) return;
    closedRef.current = true;
    fn();
  };

  return (
    <input
      ref={inputRef}
      className="xg-editor"
      style={{ left, top, width: Math.max(width, 60), height }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          close(() => onCommit(valueRef.current, e.shiftKey ? "up" : "down"));
        } else if (e.key === "Tab") {
          e.preventDefault();
          close(() => onCommit(valueRef.current, e.shiftKey ? "left" : "right"));
        } else if (e.key === "Escape") {
          e.preventDefault();
          close(onCancel);
        }
      }}
      onBlur={() => close(() => onCommit(valueRef.current))}
    />
  );
}
