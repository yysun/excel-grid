// @vitest-environment jsdom
// Tests for xlsx serialization: numFmt mapping in both directions, full
// round-trip fidelity (values, formulas, styles, formats, widths), and a
// hand-assembled Excel-convention fixture (sharedStrings, shared formulas,
// builtin numFmtIds, theme colors, stored ZIP entries). jsdom provides
// DOMParser; the guard below restores Node's compression streams when the
// jsdom environment lacks them.
// Recent changes: initial implementation.

import { deflateRawSync } from "node:zlib";
import {
  CompressionStream as NodeCompressionStream,
  DecompressionStream as NodeDecompressionStream,
} from "node:stream/web";
import { describe, expect, it } from "vitest";
import { GridStore, type RawChange } from "../state/GridStore";
import type { GridSnapshot } from "../types";
import { parseCellRef } from "./cellRef";
import { numFmtFor, numFmtToStyle, snapshotToXlsx, xlsxToSnapshot } from "./xlsx";
import { readZip } from "./zip";

const g = globalThis as Record<string, unknown>;
if (typeof g.CompressionStream === "undefined") g.CompressionStream = NodeCompressionStream;
if (typeof g.DecompressionStream === "undefined") g.DecompressionStream = NodeDecompressionStream;

const enc = new TextEncoder();

/** Display text per cell ref, computed by a headless store. */
function displays(snapshot: GridSnapshot): Record<string, string> {
  let maxRow = 0;
  let maxCol = 0;
  const changes: RawChange[] = [];
  for (const [ref, raw] of Object.entries(snapshot.cells)) {
    const p = parseCellRef(ref);
    if (!p) continue;
    maxRow = Math.max(maxRow, p.row);
    maxCol = Math.max(maxCol, p.col);
    changes.push({ row: p.row, col: p.col, raw });
  }
  const store = new GridStore(maxRow + 1, maxCol + 1, 100);
  store.setCells(changes, false);
  for (const [ref, style] of Object.entries(snapshot.styles)) {
    const p = parseCellRef(ref);
    if (p) store.initStyle(p.row, p.col, style);
  }
  const out: Record<string, string> = {};
  for (const [ref] of Object.entries(snapshot.cells)) {
    const p = parseCellRef(ref)!;
    out[ref] = store.getDisplay(p.row, p.col);
  }
  return out;
}

// ---- numFmt mapping ----

describe("numFmtFor / numFmtToStyle", () => {
  it("uses builtin ids where they match the grid formats", () => {
    expect(numFmtFor({})).toBeNull();
    expect(numFmtFor({ decimals: 0 })).toBe(1);
    expect(numFmtFor({ decimals: 2 })).toBe(2);
    expect(numFmtFor({ numFmt: "percent" })).toBe(9);
    expect(numFmtFor({ numFmt: "percent", decimals: 2 })).toBe(10);
    expect(numFmtFor({ numFmt: "thousands", decimals: 0 })).toBe(3);
    expect(numFmtFor({ numFmt: "number" })).toBe(4);
    expect(numFmtFor({ numFmt: "scientific" })).toBe(11);
    expect(numFmtFor({ numFmt: "date" })).toBe(14);
    expect(numFmtFor({ numFmt: "time" })).toBe(19);
    expect(numFmtFor({ numFmt: "duration" })).toBe(46);
  });

  it("emits custom codes for the rest", () => {
    expect(numFmtFor({ decimals: 3 })).toBe("0.000");
    expect(numFmtFor({ numFmt: "percent", decimals: 1 })).toBe("0.0%");
    expect(numFmtFor({ numFmt: "thousands" })).toBe("#,##0.##########");
    expect(numFmtFor({ numFmt: "currency" })).toBe('"$"#,##0.00;"-$"#,##0.00');
    expect(numFmtFor({ numFmt: "currency", decimals: 0 })).toBe('"$"#,##0;"-$"#,##0');
    expect(numFmtFor({ numFmt: "scientific", decimals: 0 })).toBe("0E+00");
    expect(numFmtFor({ numFmt: "datetime" })).toBe("m/d/yyyy hh:mm:ss");
  });

  it("maps builtin ids back to grid formats", () => {
    expect(numFmtToStyle(0, undefined)).toEqual({});
    expect(numFmtToStyle(1, undefined)).toEqual({ decimals: 0 });
    expect(numFmtToStyle(4, undefined)).toEqual({ numFmt: "number", decimals: 2 });
    expect(numFmtToStyle(9, undefined)).toEqual({ numFmt: "percent", decimals: 0 });
    expect(numFmtToStyle(11, undefined)).toEqual({ numFmt: "scientific", decimals: 2 });
    expect(numFmtToStyle(15, undefined)).toEqual({ numFmt: "date" });
    expect(numFmtToStyle(20, undefined)).toEqual({ numFmt: "time" });
    expect(numFmtToStyle(22, undefined)).toEqual({ numFmt: "datetime" });
    expect(numFmtToStyle(40, undefined)).toEqual({ numFmt: "number", decimals: 2 });
    expect(numFmtToStyle(44, undefined)).toEqual({ numFmt: "currency", decimals: 2 });
    expect(numFmtToStyle(46, undefined)).toEqual({ numFmt: "duration" });
    expect(numFmtToStyle(164, undefined)).toEqual({});
  });

  it("classifies custom codes heuristically", () => {
    expect(numFmtToStyle(164, "0.0%")).toEqual({ numFmt: "percent", decimals: 1 });
    expect(numFmtToStyle(164, "0.000E+00")).toEqual({ numFmt: "scientific", decimals: 3 });
    expect(numFmtToStyle(164, "[h]:mm:ss")).toEqual({ numFmt: "duration" });
    expect(numFmtToStyle(164, '"$"#,##0.00;"-$"#,##0.00')).toEqual({
      numFmt: "currency",
      decimals: 2,
    });
    expect(numFmtToStyle(164, '"$"#,##0;"-$"#,##0')).toEqual({
      numFmt: "currency",
      decimals: 0,
    });
    expect(numFmtToStyle(164, "[$USD-409] #,##0.00")).toEqual({
      numFmt: "currency",
      decimals: 2,
    });
    expect(numFmtToStyle(164, "m/d/yyyy hh:mm:ss")).toEqual({ numFmt: "datetime" });
    expect(numFmtToStyle(164, "yyyy-mm-dd")).toEqual({ numFmt: "date" });
    expect(numFmtToStyle(164, "hh:mm")).toEqual({ numFmt: "time" });
    expect(numFmtToStyle(164, "#,##0.###")).toEqual({ numFmt: "thousands" });
    expect(numFmtToStyle(164, "#,##0.000")).toEqual({ numFmt: "number", decimals: 3 });
    expect(numFmtToStyle(164, "0.0000")).toEqual({ decimals: 4 });
    expect(numFmtToStyle(164, "@")).toEqual({});
  });
});

// ---- round-trip ----

describe("snapshotToXlsx -> xlsxToSnapshot round-trip", () => {
  const snapshot: GridSnapshot = {
    cells: {
      A1: "hello & <world>",
      B1: "1234.5",
      C1: "TRUE",
      D1: "'=SUM(1,2)",
      A2: "2024-01-05",
      B2: "0.4275",
      C2: "1234567.891",
      D2: "-42.5",
      A3: "=SUM(B1:B2)*2",
      B3: "=1/0",
      C3: "0.75",
      D3: "12345.678",
      A4: "3:59 PM",
      B4: "2024-01-05 13:30:00",
      C4: "1234.5",
      D4: "0.00012345",
      E4: "1234.5",
    },
    styles: {
      A1: {
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        fontSize: 16,
        color: "#e60000",
        background: "#ffff00",
        align: "center",
        valign: "middle",
        wrap: true,
      },
      B1: { numFmt: "currency" },
      A2: { numFmt: "date" },
      B2: { numFmt: "percent", decimals: 1 },
      C2: { numFmt: "thousands" },
      D2: { numFmt: "number", decimals: 3 },
      C3: { numFmt: "duration" },
      D3: { decimals: 0 },
      A4: { numFmt: "time" },
      B4: { numFmt: "datetime" },
      C4: { numFmt: "scientific", decimals: 0 },
      D4: { numFmt: "scientific" },
      E4: { numFmt: "currency", decimals: 0 },
      E5: { background: "#00ff00" }, // style-only empty cell
    },
    colWidths: { 0: 150, 2: 80 },
  };

  it("preserves display values, styles, and column widths", async () => {
    const bytes = await snapshotToXlsx(snapshot);
    expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
    const back = await xlsxToSnapshot(bytes);

    // Formulas and plain strings survive as raw text.
    expect(back.cells.A3).toBe("=SUM(B1:B2)*2");
    expect(back.cells.B3).toBe("=1/0");
    expect(back.cells.A1).toBe("hello & <world>");
    expect(back.cells.C1).toBe("TRUE");
    expect(back.cells.D1).toBe("'=SUM(1,2)");

    // Date/time literals come back as serial + format (display-identical).
    const before = displays(snapshot);
    const after = displays(back);
    for (const ref of Object.keys(snapshot.cells)) {
      expect(after[ref], `display of ${ref}`).toBe(before[ref]);
    }

    // Direct style fields survive verbatim.
    expect(back.styles.A1).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      fontSize: 16,
      color: "#e60000",
      background: "#ffff00",
      align: "center",
      valign: "middle",
      wrap: true,
    });
    expect(back.styles.E5).toEqual({ background: "#00ff00" });
    expect(back.styles.A2?.numFmt).toBe("date");
    expect(back.styles.B2).toMatchObject({ numFmt: "percent", decimals: 1 });
    expect(back.styles.E4).toMatchObject({ numFmt: "currency", decimals: 0 });
    expect(back.styles.C2?.numFmt).toBe("thousands");
    expect(back.styles.C3?.numFmt).toBe("duration");
    expect(back.styles.B4?.numFmt).toBe("datetime");

    // Column widths within +-1px of the original.
    expect(Math.abs(back.colWidths[0] - 150)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.colWidths[2] - 80)).toBeLessThanOrEqual(1);
    expect(back.colWidths[1]).toBeUndefined();
  });

  it("caches empty (not #REF!) for refs beyond the used range", async () => {
    // A1 references empty C1 outside the 1x1 used range; the cached value
    // must match what the real (larger) grid shows, not a bounds error.
    const snap: GridSnapshot = { cells: { A1: "=C1" }, styles: {}, colWidths: {} };
    const bytes = await snapshotToXlsx(snap);
    const back = await xlsxToSnapshot(bytes);
    expect(back.cells.A1).toBe("=C1");
    const sheetXml = new TextDecoder().decode(
      (await readZip(bytes)).get("xl/worksheets/sheet1.xml")
    );
    expect(sheetXml).toContain("<f>C1</f>");
    expect(sheetXml).not.toContain("#REF!");
  });

  it("re-exports an unknown-function formula intact", async () => {
    const snap: GridSnapshot = {
      cells: { A1: "=XLOOKUP(1,B1:B9,C1:C9)" },
      styles: {},
      colWidths: {},
    };
    const once = await xlsxToSnapshot(await snapshotToXlsx(snap));
    expect(once.cells.A1).toBe("=XLOOKUP(1,B1:B9,C1:C9)");
    const twice = await xlsxToSnapshot(await snapshotToXlsx(once));
    expect(twice.cells.A1).toBe("=XLOOKUP(1,B1:B9,C1:C9)");
  });
});

// ---- foreign (Excel-convention) fixture ----

/** Assemble a ZIP the way a foreign producer might: per-entry method. */
function buildForeignZip(
  entries: Array<{ name: string; xml: string; stored?: boolean }>
): Uint8Array {
  function crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      let n = (c ^ data[i]) & 0xff;
      for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      c = n ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const content = enc.encode(e.xml);
    const payload = e.stored ? content : new Uint8Array(deflateRawSync(content));
    const method = e.stored ? 0 : 8;
    const crc = crc32(content);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, content.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, content.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    locals.push(local, payload);
    centrals.push(cen);
    offset += local.length + payload.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const p of [...locals, ...centrals, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

describe("xlsxToSnapshot on an Excel-convention workbook", () => {
  const SPREADSHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
  const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  const fixture = buildForeignZip([
    {
      name: "_rels/.rels",
      stored: true, // exercise a stored (method 0) entry
      xml: `<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="/xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      xml: `<workbook ${SPREADSHEET_NS} ${R_NS}><sheets><sheet name="Data" sheetId="1" r:id="rId7"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml:
        `<Relationships ${REL_NS}>` +
        `<Relationship Id="rId7" Type="${REL_TYPE}/worksheet" Target="worksheets/data.xml"/>` +
        `<Relationship Id="rId8" Type="${REL_TYPE}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId9" Type="${REL_TYPE}/sharedStrings" Target="sharedStrings.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/sharedStrings.xml",
      xml:
        `<sst ${SPREADSHEET_NS} count="3" uniqueCount="3">` +
        `<si><t>plain</t></si>` +
        `<si><r><rPr><b/></rPr><t>rich </t></r><r><t xml:space="preserve">text_x000A_run</t></r></si>` +
        `<si><t>=2+2</t></si>` +
        `</sst>`,
    },
    {
      name: "xl/styles.xml",
      xml:
        `<styleSheet ${SPREADSHEET_NS}>` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
        `<fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border/></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="6">` +
        `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `<xf numFmtId="44" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="46" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `</cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`,
    },
    {
      name: "xl/worksheets/data.xml",
      xml:
        `<worksheet ${SPREADSHEET_NS}>` +
        `<cols><col min="1" max="2" width="20.7143" customWidth="1"/></cols>` +
        `<sheetData>` +
        `<row r="1">` +
        `<c r="A1" t="s"><v>0</v></c>` +
        `<c r="B1" t="s" s="4"><v>1</v></c>` +
        `<c r="C1" t="s"><v>2</v></c>` +
        `<c r="D1" t="b"><v>1</v></c>` +
        `</row>` +
        `<row r="2">` +
        `<c r="A2" s="1"><v>45296</v></c>` +
        `<c r="B2" s="2"><v>0.5</v></c>` +
        `<c r="C2" s="3"><v>99.5</v></c>` +
        `<c r="D2"><f>A2+1</f><v>45297</v></c>` +
        `<c r="E2" s="5"><v>0.75</v></c>` +
        `</row>` +
        `<row r="3">` +
        `<c r="A3"><f t="shared" ref="A3:A5" si="0">B2*2</f><v>1</v></c>` +
        `<c r="B3"><v>7</v></c>` +
        `</row>` +
        `<row r="4"><c r="A4"><f t="shared" si="0"/><v>14</v></c></row>` +
        `<row r="5"><c r="A5"><f t="shared" si="0"/><v>0</v></c></row>` +
        `</sheetData>` +
        `</worksheet>`,
    },
  ]);

  it("imports strings, formats, shared formulas, widths, and styles", async () => {
    const snap = await xlsxToSnapshot(fixture);

    // Shared strings: plain, rich-text concat with _xHHHH_ decode, guard.
    expect(snap.cells.A1).toBe("plain");
    expect(snap.cells.B1).toBe("rich text\nrun");
    expect(snap.cells.C1).toBe("'=2+2");
    expect(snap.cells.D1).toBe("TRUE");

    // Builtin numFmts land on grid formats.
    expect(snap.cells.A2).toBe("45296");
    expect(snap.styles.A2?.numFmt).toBe("date");
    expect(snap.styles.B2).toMatchObject({ numFmt: "percent", decimals: 0 });
    expect(snap.styles.C2).toMatchObject({ numFmt: "currency", decimals: 2 });
    expect(snap.styles.E2?.numFmt).toBe("duration");

    // Plain and shared formulas (followers expanded with adjusted refs).
    expect(snap.cells.D2).toBe("=A2+1");
    expect(snap.cells.A3).toBe("=B2*2");
    expect(snap.cells.A4).toBe("=B3*2");
    expect(snap.cells.A5).toBe("=B4*2");

    // Theme color skipped, bold kept.
    expect(snap.styles.B1).toEqual({ bold: true });

    // Column widths for the min..max span.
    expect(snap.colWidths[0]).toBe(150);
    expect(snap.colWidths[1]).toBe(150);
    expect(snap.colWidths[2]).toBeUndefined();
  });

  it("rejects non-xlsx bytes with a clear error", async () => {
    await expect(xlsxToSnapshot(enc.encode("not a zip at all"))).rejects.toThrow(/zip:/);
  });
});
