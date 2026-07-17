// Demo app for excel-grid.
// Features: mounts a 10,000 x 100 grid with sample data (numbers, text,
// SUM/AVERAGE/IF formulas), an onChange event log, and buttons exercising the
// imperative ref API (setCell / getCell).
// Recent changes: initial implementation.

import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ExcelGrid,
  type ExcelGridHandle,
  type GridChange,
} from "../src/index";

const initialCells: Record<string, string> = {
  A1: "Item",
  B1: "Qty",
  C1: "Price",
  D1: "Total",
  A2: "Widget",
  B2: "4",
  C2: "2.5",
  D2: "=B2*C2",
  A3: "Gadget",
  B3: "10",
  C3: "1.75",
  D3: "=B3*C3",
  A4: "Doohickey",
  B4: "2",
  C4: "12",
  D4: "=B4*C4",
  A6: "Sum",
  D6: "=SUM(D2:D4)",
  A7: "Average",
  D7: "=AVERAGE(D2:D4)",
  A8: "Status",
  D8: '=IF(D6>50,"big order","small order")',
};

function App() {
  const gridRef = useRef<ExcelGridHandle>(null);
  const [log, setLog] = useState<string[]>([]);
  const [apiResult, setApiResult] = useState("");

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
        <strong>excel-grid demo</strong> — 10,000 × 100
        <button
          id="api-set"
          onClick={() => gridRef.current?.setCell("F1", "set via API")}
        >
          Set F1 via API
        </button>
        <button
          id="api-read"
          onClick={() => {
            const cell = gridRef.current?.getCell("D6");
            setApiResult(`D6 raw=${cell?.raw ?? ""} value=${cell?.value ?? ""}`);
          }}
        >
          Read D6 via API
        </button>
        <span id="api-result" style={{ color: "#1967d2" }}>{apiResult}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ExcelGrid
          ref={gridRef}
          rows={10000}
          cols={100}
          initialCells={initialCells}
          onChange={handleChange}
        />
      </div>
      <div id="change-log" style={{ height: 90, overflow: "auto", fontFamily: "monospace", fontSize: 11, background: "#f6f8fa", padding: 6 }}>
        {log.length === 0 ? "onChange log (edit a cell)…" : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
