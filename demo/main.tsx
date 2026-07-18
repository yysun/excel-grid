// Demo app for excel-grid.
// Features: loads demo/accounts-6.json (1,328 CRM account records with a
// nested JSON `data` payload per record) into the grid, plus an onChange
// event log and buttons exercising the imperative ref API (setCell / getCell).
// Recent changes: replaced the synthetic sample data with accounts-6.json.

import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ExcelGrid,
  type ExcelGridHandle,
  type GridChange,
} from "../src/index";
import accounts from "./accounts-6.json";

interface AccountRecord {
  id: number;
  name: string;
  data: string;
  teamId: number | null;
  noteCount: number;
}

// The nested `data` JSON uses inconsistent key spellings across records
// (e.g. "numberOfAgents" vs "# of agents", "repId" vs "RepID"), so each
// column lists the aliases to fall back through.
const columns: { label: string; aliases: string[] }[] = [
  { label: "Brand", aliases: ["brand"] },
  { label: "Status", aliases: ["status", "Status"] },
  { label: "Phone", aliases: ["phoneNumber"] },
  { label: "Website", aliases: ["website"] },
  { label: "City", aliases: ["city", "City"] },
  { label: "Province", aliases: ["province"] },
  { label: "Agents", aliases: ["numberOfAgents", "# of agents"] },
  { label: "Sales Type", aliases: ["salesType", "type", "Type"] },
  { label: "Rep", aliases: ["repId", "RepID"] },
  { label: "Origination", aliases: ["origination", "Origination"] },
  { label: "Contract Date", aliases: ["contractDate"] },
  {
    label: "Target Close",
    aliases: ["targetCloseDate", "target Close Date", "Target Close Date"],
  },
  {
    label: "Last Outreach",
    aliases: ["lastOutreach", "last Outreach", "Last Outreach"],
  },
  {
    label: "Next Outreach",
    aliases: ["nextOutreach", "next Outreach", "Next Outreach"],
  },
  { label: "Markets", aliases: ["markets", "market(s)", "Market(s)"] },
  { label: "Locations", aliases: ["locations"] },
];

function colLetter(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function buildCells(records: AccountRecord[]): Record<string, string> {
  const cells: Record<string, string> = {};
  const headers = ["ID", "Name", ...columns.map((c) => c.label), "Notes"];
  headers.forEach((h, i) => {
    cells[`${colLetter(i)}1`] = h;
  });

  const sorted = [...records].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach((rec, i) => {
    const row = i + 2;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rec.data);
    } catch {
      // leave the detail columns blank for unparseable payloads
    }
    const values = [
      rec.id,
      rec.name,
      ...columns.map(({ aliases }) => {
        for (const key of aliases) {
          const v = data[key];
          if (v !== undefined && v !== null && v !== "") return v;
        }
        return "";
      }),
      rec.noteCount,
    ];
    values.forEach((v, col) => {
      const raw = String(v);
      if (raw === "") return;
      // A leading "=" in source data would otherwise be parsed as a formula.
      cells[`${colLetter(col)}${row}`] = raw.startsWith("=") ? `'${raw}` : raw;
    });
  });

  // Summary row demonstrating formulas over the loaded data.
  const agentsCol = colLetter(2 + columns.findIndex((c) => c.label === "Agents"));
  const lastRow = sorted.length + 1;
  const summaryRow = lastRow + 2;
  cells[`A${summaryRow}`] = "Total agents";
  cells[`${agentsCol}${summaryRow}`] = `=SUM(${agentsCol}2:${agentsCol}${lastRow})`;
  return cells;
}

const records = accounts as AccountRecord[];
const initialCells = buildCells(records);
const rowCount = records.length + 100;
const colCount = Math.max(columns.length + 3, 26);

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
        <strong>excel-grid demo</strong> — accounts-6.json ({records.length} accounts)
        <button
          id="api-set"
          onClick={() => gridRef.current?.setCell("F1", "set via API")}
        >
          Set F1 via API
        </button>
        <button
          id="api-read"
          onClick={() => {
            const cell = gridRef.current?.getCell("B2");
            setApiResult(`B2 raw=${cell?.raw ?? ""} value=${cell?.value ?? ""}`);
          }}
        >
          Read B2 via API
        </button>
        <span id="api-result" style={{ color: "#1967d2" }}>{apiResult}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ExcelGrid
          ref={gridRef}
          rows={rowCount}
          cols={colCount}
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
