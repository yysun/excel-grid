// Demo app for excel-grid.
// Features: localStorage persistence keyed by file name — every edit
// (data, formatting, column widths) autosaves a GridSnapshot under
// "excel-grid-demo:file:{fileName}" (300 ms debounce, flushed on
// pagehide/hidden); boot restores the last file ("excel-grid-demo:current")
// or shows a blank grid; header buttons: New (confirm + clear), Open CSV…
// (File API, imported "=" cells apostrophe-escaped), Save CSV (displayed
// text of the used range, Blob download); onChange event log.
// Recent changes: replaced the bundled accounts-6.json boot data with the
// localStorage/CSV workflow above.

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ExcelGrid,
  colToLetters,
  parseCellRef,
  parseCSV,
  toCSV,
  type ExcelGridHandle,
  type GridChange,
  type GridSnapshot,
} from "../src/index";

const DEFAULT_FILE_NAME = "untitled.csv";
const CURRENT_KEY = "excel-grid-demo:current";
const fileKey = (name: string) => `excel-grid-demo:file:${name}`;

const BLANK_ROWS = 1000;
const BLANK_COLS = 26;

interface DocState {
  fileName: string;
  snapshot: GridSnapshot | null;
  /** React key for ExcelGrid: bump to remount with fresh initial state. */
  epoch: number;
}

function loadInitialDoc(): DocState {
  try {
    const fileName = localStorage.getItem(CURRENT_KEY) ?? DEFAULT_FILE_NAME;
    const json = localStorage.getItem(fileKey(fileName));
    if (json) {
      const snapshot = JSON.parse(json) as GridSnapshot;
      if (snapshot && typeof snapshot === "object" && snapshot.cells) {
        return { fileName, snapshot, epoch: 0 };
      }
    }
    return { fileName, snapshot: null, epoch: 0 };
  } catch {
    // Corrupt stored JSON (or storage unavailable): start blank.
    return { fileName: DEFAULT_FILE_NAME, snapshot: null, epoch: 0 };
  }
}

/** Grid dimensions large enough for the snapshot plus editing headroom. */
function gridSize(snapshot: GridSnapshot | null): { rows: number; cols: number } {
  let maxRow = 0;
  let maxCol = 0;
  for (const ref of Object.keys(snapshot?.cells ?? {})) {
    const parsed = parseCellRef(ref);
    if (parsed) {
      maxRow = Math.max(maxRow, parsed.row);
      maxCol = Math.max(maxCol, parsed.col);
    }
  }
  return {
    rows: Math.max(BLANK_ROWS, maxRow + 101),
    cols: Math.max(BLANK_COLS, maxCol + 3),
  };
}

function snapshotFromCSV(text: string): GridSnapshot {
  const matrix = parseCSV(text);
  const cells: Record<string, string> = {};
  matrix.forEach((row, r) => {
    row.forEach((field, c) => {
      if (field === "") return;
      // Foreign CSV data must never execute as a formula: apostrophe-
      // escape a leading "=" (the apostrophe stays visible, by design).
      cells[`${colToLetters(c)}${r + 1}`] = field.startsWith("=") ? `'${field}` : field;
    });
  });
  return { cells, styles: {}, colWidths: {} };
}

function App() {
  const gridRef = useRef<ExcelGridHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<DocState>(loadInitialDoc);
  const [log, setLog] = useState<string[]>([]);

  const { rows, cols } = useMemo(() => gridSize(doc.snapshot), [doc]);

  // ---- autosave (debounced; flushed on pagehide / tab hidden) ----

  const saveTimer = useRef<number | null>(null);
  const persistNow = () => {
    const snapshot = gridRef.current?.getSnapshot();
    if (!snapshot) return;
    try {
      localStorage.setItem(fileKey(doc.fileName), JSON.stringify(snapshot));
      localStorage.setItem(CURRENT_KEY, doc.fileName);
    } catch (e) {
      console.error("excel-grid demo: autosave failed", e);
    }
  };
  const persistRef = useRef(persistNow);
  persistRef.current = persistNow;

  const handleStateChange = () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      persistRef.current();
    }, 300);
  };

  /** Run any pending debounced save now (still under the current file name). */
  const flushPendingSave = () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      persistRef.current();
    }
  };
  const flushRef = useRef(flushPendingSave);
  flushRef.current = flushPendingSave;

  useEffect(() => {
    const flush = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ---- file actions ----

  const openFile = async (file: File) => {
    // Don't lose the previous file's last edit to the debounce window.
    flushPendingSave();
    const snapshot = snapshotFromCSV(await file.text());
    try {
      localStorage.setItem(fileKey(file.name), JSON.stringify(snapshot));
      localStorage.setItem(CURRENT_KEY, file.name);
    } catch (e) {
      console.error("excel-grid demo: persisting opened file failed", e);
    }
    setDoc((d) => ({ fileName: file.name, snapshot, epoch: d.epoch + 1 }));
  };

  const saveCSV = () => {
    const data = gridRef.current?.getData() ?? [];
    let maxRow = -1;
    let maxCol = -1;
    const byCoord = new Map<string, string>();
    for (const { ref, display } of data) {
      const parsed = parseCellRef(ref);
      if (!parsed) continue;
      maxRow = Math.max(maxRow, parsed.row);
      maxCol = Math.max(maxCol, parsed.col);
      byCoord.set(`${parsed.row},${parsed.col}`, display);
    }
    const matrix: string[][] = [];
    for (let r = 0; r <= maxRow; r++) {
      const row: string[] = [];
      for (let c = 0; c <= maxCol; c++) row.push(byCoord.get(`${r},${c}`) ?? "");
      matrix.push(row);
    }
    const blob = new Blob([toCSV(matrix)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName.endsWith(".csv") ? doc.fileName : `${doc.fileName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const newGrid = () => {
    if (!window.confirm("Clear the grid and start a new file? Saved data for the default file will be removed.")) {
      return;
    }
    // Persist any pending edit under the current name first (removing the
    // default entry below then discards it only when it IS the default,
    // which is exactly what the user just confirmed).
    flushPendingSave();
    try {
      localStorage.removeItem(fileKey(DEFAULT_FILE_NAME));
      localStorage.setItem(CURRENT_KEY, DEFAULT_FILE_NAME);
    } catch (e) {
      console.error("excel-grid demo: resetting storage failed", e);
    }
    setDoc((d) => ({ fileName: DEFAULT_FILE_NAME, snapshot: null, epoch: d.epoch + 1 }));
  };

  // ---- change log ----

  const handleChange = (changes: GridChange[]) => {
    const line = changes
      .slice(0, 5)
      .map((c) => `${c.ref}=${JSON.stringify(c.raw)}→${JSON.stringify(c.value)}`)
      .join(", ");
    setLog((l) => [
      `${changes.length} cell(s): ${line}${changes.length > 5 ? ", …" : ""}`,
      ...l.slice(0, 4),
    ]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 12, gap: 8, boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>excel-grid demo</strong>
        <span id="file-name" style={{ fontFamily: "monospace", background: "#eef2f6", padding: "2px 8px", borderRadius: 4 }}>
          {doc.fileName}
        </span>
        <button onClick={newGrid}>New</button>
        <button onClick={() => fileInputRef.current?.click()}>Open CSV…</button>
        <button onClick={saveCSV}>Save CSV</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            e.target.value = "";
          }}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ExcelGrid
          key={doc.epoch}
          ref={gridRef}
          rows={rows}
          cols={cols}
          initialState={doc.snapshot ?? undefined}
          onChange={handleChange}
          onStateChange={handleStateChange}
        />
      </div>
      <div id="change-log" style={{ height: 90, overflow: "auto", fontFamily: "monospace", fontSize: 11, background: "#f6f8fa", padding: 6 }}>
        {log.length === 0 ? "onChange log (edit a cell)…" : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
