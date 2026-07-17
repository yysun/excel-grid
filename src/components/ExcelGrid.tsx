// ExcelGrid: the Excel-Web-style spreadsheet component.
// Features: virtualized cells + sticky-style header strips, formula bar with
// name box, mouse/keyboard selection (cell, range, row/col, all), Excel-style
// navigation, in-cell + formula-bar editing, formula recalculation via
// GridStore, TSV clipboard (native copy/cut/paste events + internal fallback),
// undo/redo shortcuts, column resize grips, and a fill handle with
// relative-reference adjustment.
// Recent changes: header clicks preventDefault to keep grid focus; clipboard
// shortcuts also use the async Clipboard API + internal fallback; commitEditor
// no longer runs side effects inside a state updater (StrictMode safety).

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
import { GridStore, type RawChange } from "../state/GridStore";
import type {
  CellCoord,
  CellRange,
  ExcelGridHandle,
  ExcelGridProps,
} from "../types";
import {
  cellKey,
  colToLetters,
  formatCellRef,
  normalizeRange,
  parseCellRef,
  rangeContains,
} from "../utils/cellRef";
import { parseTSV, toTSV } from "../utils/tsv";
import { buildColMetrics, useVirtualRange } from "./useVirtualRange";
import { useSyncExternalStore } from "react";

const HEADER_HEIGHT = 24;
const ROW_HEADER_WIDTH = 46;

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

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export const ExcelGrid = forwardRef<ExcelGridHandle, ExcelGridProps>(
  function ExcelGrid(props, ref) {
    const {
      rows = 1000,
      cols = 26,
      initialCells,
      onChange,
      rowHeight = 24,
      defaultColWidth = 100,
      className,
    } = props;

    const storeRef = useRef<GridStore | null>(null);
    if (storeRef.current === null) {
      const store = new GridStore(rows, cols, defaultColWidth);
      if (initialCells) {
        const changes: RawChange[] = [];
        for (const [refText, raw] of Object.entries(initialCells)) {
          const parsed = parseCellRef(refText);
          if (parsed) changes.push({ row: parsed.row, col: parsed.col, raw });
        }
        store.setCells(changes, false);
      }
      storeRef.current = store;
    }
    const store = storeRef.current;
    useEffect(() => {
      store.onChange = onChange ?? null;
    }, [store, onChange]);

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
    const internalClipboard = useRef<InternalClipboard | null>(null);
    const pasteHandledAt = useRef(0);
    const editorRef = useRef<{ commit: () => void } | null>(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const colWidths = useMemo(
      () => Array.from({ length: cols }, (_, i) => store.getColWidth(i)),
      [store, cols, version]
    );
    const metrics = useMemo(() => buildColMetrics(colWidths), [colWidths]);
    const totalHeight = rows * rowHeight;

    const win = useVirtualRange(
      scroll.top,
      scroll.left,
      viewport.width,
      viewport.height,
      rowHeight,
      rows,
      metrics
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

    const selRange = useMemo(
      () => normalizeRange(selection.anchor, selection.focus),
      [selection]
    );
    const active = selection.anchor;

    // ---- helpers ----

    const ensureVisible = useCallback(
      (coord: CellCoord) => {
        const body = bodyRef.current;
        if (!body) return;
        const x0 = metrics.offsets[coord.col];
        const x1 = metrics.offsets[coord.col + 1];
        const y0 = coord.row * rowHeight;
        const y1 = y0 + rowHeight;
        if (x0 < body.scrollLeft) body.scrollLeft = x0;
        else if (x1 > body.scrollLeft + body.clientWidth) {
          body.scrollLeft = x1 - body.clientWidth;
        }
        if (y0 < body.scrollTop) body.scrollTop = y0;
        else if (y1 > body.scrollTop + body.clientHeight) {
          body.scrollTop = y1 - body.clientHeight;
        }
      },
      [metrics, rowHeight]
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
        const x = e.clientX - rect.left + body.scrollLeft;
        const y = e.clientY - rect.top + body.scrollTop;
        return {
          row: clamp(Math.floor(y / rowHeight), 0, rows - 1),
          col: metrics.colAtX(clamp(x, 0, metrics.totalWidth - 1)),
        };
      },
      [metrics, rowHeight, rows]
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
      const r = selRange;
      const matrix: string[][] = [];
      for (let row = r.startRow; row <= r.endRow; row++) {
        const line: string[] = [];
        for (let col = r.startCol; col <= r.endCol; col++) {
          line.push(store.getRaw(row, col));
        }
        matrix.push(line);
      }
      return { tsv: toTSV(matrix), source: r };
    }, [selRange, store]);

    const applyPaste = useCallback(
      (text: string) => {
        const internal = internalClipboard.current;
        const isInternal = internal !== null && internal.tsv === text;
        const matrix = parseTSV(text);
        if (matrix.length === 0) return;
        const target: CellCoord = { row: selRange.startRow, col: selRange.startCol };
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
      [selRange, store, rows, cols]
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
        const move = (dr: number, dc: number, extend = false) => {
          e.preventDefault();
          const base = extend ? selection.focus : active;
          setActive({ row: base.row + dr, col: base.col + dc }, extend);
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
          case "Home":
            e.preventDefault();
            return setActive(mod ? { row: 0, col: 0 } : { row, col: 0 });
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
            const { tsv, source } = buildTSV();
            internalClipboard.current = { tsv, source, cut: k === "x" };
            navigator.clipboard?.writeText(tsv).catch(() => {});
            return;
          }
          if (k === "v") {
            // Native paste event should follow; fall back to the async
            // Clipboard API, then the internal clipboard, when it doesn't.
            const at = Date.now();
            setTimeout(async () => {
              if (pasteHandledAt.current >= at) return;
              let text = "";
              try {
                text = await navigator.clipboard.readText();
              } catch {
                // Permission denied or API unavailable.
              }
              if (pasteHandledAt.current >= at) return;
              if (!text && internalClipboard.current) {
                text = internalClipboard.current.tsv;
              }
              if (text) {
                pasteHandledAt.current = Date.now();
                applyPaste(text);
              }
            }, 120);
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
        openEditor,
        store,
        rows,
        cols,
        viewport.height,
        rowHeight,
        applyPaste,
        buildTSV,
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
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      [editor, coordFromMouse, setActive]
    );

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        const c = coordFromMouse(e);
        openEditor(c.row, c.col, store.getRaw(c.row, c.col), false);
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
            .map(({ row, col, raw, value }) => ({
              ref: formatCellRef(row, col),
              raw,
              value,
            })),
      }),
      [store]
    );

    // ---- rendering ----

    const cells = [];
    for (let row = win.rowStart; row <= win.rowEnd; row++) {
      for (let col = win.colStart; col <= win.colEnd; col++) {
        const display = store.getDisplay(row, col);
        const cell = display === "" ? null : store.getCell(row, col);
        const isNum = cell !== null && !cell.error && typeof cell.value === "number";
        cells.push(
          <div
            key={cellKey(row, col)}
            className={
              "xg-cell" +
              (isNum ? " xg-cell--num" : "") +
              (cell?.error ? " xg-cell--err" : "")
            }
            style={{
              left: metrics.offsets[col],
              top: row * rowHeight,
              width: colWidths[col],
              height: rowHeight,
            }}
          >
            {display}
          </div>
        );
      }
    }

    const colHeaders = [];
    for (let col = win.colStart; col <= win.colEnd; col++) {
      const inSel = col >= selRange.startCol && col <= selRange.endCol;
      colHeaders.push(
        <div
          key={col}
          className={"xg-header-cell" + (inSel ? " xg-header-cell--sel" : "")}
          style={{ left: metrics.offsets[col], top: 0, width: colWidths[col], height: HEADER_HEIGHT }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.preventDefault(); // Keep keyboard focus on the grid body.
              selectColumn(col);
            }
          }}
        >
          {colToLetters(col)}
          <div
            className="xg-resize-grip"
            onMouseDown={(e) => beginResizeDrag(e, col)}
          />
        </div>
      );
    }

    const rowHeaders = [];
    for (let row = win.rowStart; row <= win.rowEnd; row++) {
      const inSel = row >= selRange.startRow && row <= selRange.endRow;
      rowHeaders.push(
        <div
          key={row}
          className={"xg-header-cell" + (inSel ? " xg-header-cell--sel" : "")}
          style={{ left: 0, top: row * rowHeight, width: ROW_HEADER_WIDTH, height: rowHeight }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.preventDefault(); // Keep keyboard focus on the grid body.
              selectRow(row);
            }
          }}
        >
          {row + 1}
        </div>
      );
    }

    const rectForRange = (r: CellRange) => ({
      left: metrics.offsets[r.startCol],
      top: r.startRow * rowHeight,
      width: metrics.offsets[r.endCol + 1] - metrics.offsets[r.startCol],
      height: (r.endRow - r.startRow + 1) * rowHeight,
    });

    const selRect = rectForRange(selRange);
    const activeRect = rectForRange(normalizeRange(active, active));
    const isMultiCell =
      selRange.startRow !== selRange.endRow || selRange.startCol !== selRange.endCol;

    const activeRaw = store.getRaw(active.row, active.col);

    return (
      <div
        className={"xg-root" + (className ? " " + className : "")}
        onCopy={(e) => handleCopyCut(e, false)}
        onCut={(e) => handleCopyCut(e, true)}
        onPaste={handlePaste}
      >
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
                width: metrics.totalWidth,
              }}
            >
              {colHeaders}
            </div>
          </div>
          <div className="xg-rowheaders">
            <div
              className="xg-header-inner"
              style={{
                transform: `translateY(${-scroll.top}px)`,
                height: totalHeight,
              }}
            >
              {rowHeaders}
            </div>
          </div>
          <div
            ref={bodyRef}
            className="xg-body"
            tabIndex={0}
            onScroll={(e) => {
              const t = e.currentTarget;
              setScroll({ top: t.scrollTop, left: t.scrollLeft });
            }}
            onKeyDown={handleKeyDown}
            onMouseDown={beginSelectDrag}
            onDoubleClick={handleDoubleClick}
          >
            <div
              className="xg-spacer"
              style={{ width: metrics.totalWidth, height: totalHeight }}
            />
            {cells}
            {isMultiCell && <div className="xg-selection" style={selRect} />}
            <div className="xg-active" style={activeRect} />
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
            {fillPreview && (
              <div className="xg-fill-preview" style={rectForRange(fillPreview)} />
            )}
            {editor && (
              <CellEditor
                key={cellKey(editor.row, editor.col)}
                editor={editor}
                left={metrics.offsets[editor.col]}
                top={editor.row * rowHeight}
                width={colWidths[editor.col]}
                height={rowHeight}
                onCommit={commitEditor}
                onCancel={cancelEditor}
                apiRef={editorRef}
              />
            )}
          </div>
        </div>
      </div>
    );
  }
);

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
