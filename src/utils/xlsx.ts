// Excel .xlsx (OOXML SpreadsheetML) serialization for GridSnapshot, with
// zero runtime dependencies (ZIP layer in ./zip on native compression
// streams, XML parsing via the platform DOMParser).
// Features: snapshotToXlsx (single worksheet; inline strings; formulas
// with cached values computed by a headless GridStore; styles.xml with
// interned fonts/fills/number formats; column widths) and xlsxToSnapshot
// (first worksheet; shared strings incl. rich-text runs; shared formulas
// expanded via adjustFormula; builtin + custom number-format mapping back
// to NumFmt; 1904 date system; apostrophe-escape guard for literal "="
// strings). Unsupported inputs (theme/indexed colors, unknown format
// codes) degrade to defaults instead of failing.
// Recent changes: initial implementation.

import { adjustFormula } from "../formula/adjust";
import { GridStore, type RawChange } from "../state/GridStore";
import type { CellStyle, GridSnapshot, HAlign, VAlign } from "../types";
import { formatCellRef, parseCellRef } from "./cellRef";
import { createZip, readZip } from "./zip";

// Row/col counts passed to adjustFormula when expanding shared formulas:
// Excel's own sheet limits, so any in-bounds Excel ref stays in bounds.
const XLSX_MAX_ROWS = 1_048_576;
const XLSX_MAX_COLS = 16_384;

const NS_DOC_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Escape text for XML content/attributes; drop non-XML control chars. */
function escXml(s: string): string {
  return s
    .replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&apos;"
    )
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// ---- number-format mapping ----

/** Zero-run of length d, e.g. 3 -> "000". */
function zeros(d: number): string {
  return "0".repeat(d);
}

/**
 * Map a cell style's numFmt+decimals to an xlsx number format: a builtin
 * numFmtId (number) or a custom format code (string) the writer interns
 * from id 164. Mirrors GridStore.formatNumber display semantics.
 */
export function numFmtFor(style: CellStyle): number | string | null {
  const d = style.decimals;
  switch (style.numFmt) {
    case undefined:
    case "general":
      if (d === undefined) return null;
      if (d === 0) return 1;
      if (d === 2) return 2;
      return "0." + zeros(d);
    case "percent":
      if (d === undefined || d === 0) return 9;
      if (d === 2) return 10;
      return "0." + zeros(d) + "%";
    case "thousands":
      if (d === undefined) return "#,##0.##########";
      if (d === 0) return 3;
      if (d === 2) return 4;
      return "#,##0." + zeros(d);
    case "number": {
      const n = d ?? 2;
      if (n === 0) return 3;
      if (n === 2) return 4;
      return "#,##0." + zeros(n);
    }
    case "currency": {
      const n = d ?? 2;
      const num = n === 0 ? "#,##0" : "#,##0." + zeros(n);
      return `"$"${num};"-$"${num}`;
    }
    case "scientific": {
      const n = d ?? 2;
      if (n === 2) return 11;
      return (n === 0 ? "0" : "0." + zeros(n)) + "E+00";
    }
    case "date":
      return 14;
    case "time":
      return 19;
    case "datetime":
      return "m/d/yyyy hh:mm:ss";
    case "duration":
      return 46;
  }
}

/** Count fixed decimals in a format code's first section ("0.00" -> 2). */
function codeDecimals(section: string): number | undefined {
  const m = /\.(0+)/.exec(section);
  return m ? m[1].length : undefined;
}

/**
 * Map an xlsx numFmtId (+custom code when id >= 164) back to the grid's
 * numFmt/decimals. Unknown formats degrade to general.
 */
export function numFmtToStyle(
  id: number,
  code: string | undefined
): Pick<CellStyle, "numFmt" | "decimals"> {
  if (code === undefined) {
    if (id === 1) return { decimals: 0 };
    if (id === 2) return { decimals: 2 };
    if (id === 3) return { numFmt: "thousands", decimals: 0 };
    if (id === 4) return { numFmt: "number", decimals: 2 };
    if (id === 9) return { numFmt: "percent", decimals: 0 };
    if (id === 10) return { numFmt: "percent", decimals: 2 };
    if (id === 11) return { numFmt: "scientific", decimals: 2 };
    if (id === 48) return { numFmt: "scientific", decimals: 1 };
    if (id >= 14 && id <= 17) return { numFmt: "date" };
    if (id >= 18 && id <= 21) return { numFmt: "time" };
    if (id === 22) return { numFmt: "datetime" };
    if (id === 37 || id === 38 || id === 41) return { numFmt: "thousands", decimals: 0 };
    if (id === 39 || id === 40 || id === 43) return { numFmt: "number", decimals: 2 };
    if (id === 42 || id === 44) return { numFmt: "currency", decimals: 2 };
    if (id >= 45 && id <= 47) return { numFmt: "duration" };
    return {};
  }
  // Custom code: classify the positive (first) section heuristically.
  const section = code.split(";")[0];
  if (/\[[hms]+\]/i.test(section)) return { numFmt: "duration" };
  if (section.includes("[$") || /[$€¥£]/.test(section)) {
    // A section with no decimal point is a whole-unit format ("$"#,##0).
    const d = codeDecimals(section) ?? (section.includes(".") ? 2 : 0);
    return { numFmt: "currency", decimals: d };
  }
  // Strip bracket sections ([Red], [$-409]) and quoted literals before
  // scanning for format letters.
  const bare = section.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
  if (bare.includes("%")) return { numFmt: "percent", decimals: codeDecimals(bare) ?? 0 };
  if (/E[+-]/i.test(bare)) {
    // No "." in the mantissa means zero decimals ("0E+00"), not the default.
    return { numFmt: "scientific", decimals: codeDecimals(bare) ?? (bare.includes(".") ? 2 : 0) };
  }
  const lower = bare.toLowerCase();
  const hasDate = /[yd]/.test(lower) || /mmm/.test(lower);
  const hasTime = /[hs]/.test(lower);
  if (hasDate && hasTime) return { numFmt: "datetime" };
  if (hasDate) return { numFmt: "date" };
  if (hasTime) return { numFmt: "time" };
  if (lower.includes(",")) {
    const d = codeDecimals(lower);
    if (d === undefined) return /\.#/.test(lower) ? { numFmt: "thousands" } : { numFmt: "thousands", decimals: 0 };
    return d === 0 ? { numFmt: "thousands", decimals: 0 } : { numFmt: "number", decimals: d };
  }
  if (/^[0#.,]+$/.test(lower)) {
    const d = codeDecimals(lower);
    if (d !== undefined) return { decimals: d };
  }
  return {};
}

// ---- colors ----

/** "#rgb"/"#rrggbb" -> "FFRRGGBB" for xlsx, or null when unparseable. */
function cssToArgb(css: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return "FF" + hex.toUpperCase();
}

/** "AARRGGBB"/"RRGGBB" -> "#rrggbb", or null. */
function argbToCss(argb: string | null): string | null {
  if (!argb) return null;
  const m = /^(?:[0-9a-f]{2})?([0-9a-f]{6})$/i.exec(argb.trim());
  return m ? "#" + m[1].toLowerCase() : null;
}

// ---- writer ----

export interface XlsxOptions {
  /** Worksheet name, default "Sheet1". */
  sheetName?: string;
}

interface CellOut {
  raw: string | null;
  styleIdx: number; // 0 = default xf
}

/**
 * Serialize a GridSnapshot to a complete .xlsx workbook (one sheet).
 * Formula cells carry cached values computed by a headless GridStore.
 */
export async function snapshotToXlsx(
  snapshot: GridSnapshot,
  opts: XlsxOptions = {}
): Promise<Uint8Array> {
  const sheetName = opts.sheetName ?? "Sheet1";

  // Collect the used range from cells + styles keys.
  let maxRow = 0;
  let maxCol = 0;
  const changes: RawChange[] = [];
  const byCoord = new Map<number, Map<number, CellOut>>();
  const put = (row: number, col: number): CellOut => {
    let r = byCoord.get(row);
    if (!r) byCoord.set(row, (r = new Map()));
    let c = r.get(col);
    if (!c) r.set(col, (c = { raw: null, styleIdx: 0 }));
    return c;
  };
  for (const [ref, raw] of Object.entries(snapshot.cells)) {
    const p = parseCellRef(ref);
    if (!p) continue;
    maxRow = Math.max(maxRow, p.row);
    maxCol = Math.max(maxCol, p.col);
    changes.push({ row: p.row, col: p.col, raw });
    put(p.row, p.col).raw = raw;
  }

  // Intern styles: numFmt codes -> ids from 164, fonts, fills, cellXfs.
  const customCodes = new Map<string, number>();
  const fonts: string[] = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  const fontIdx = new Map<string, number>();
  const fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  const fillIdx = new Map<string, number>();
  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIdx = new Map<string, number>();

  const internXf = (style: CellStyle): number => {
    const key = JSON.stringify(style, Object.keys(style).sort());
    const existing = xfIdx.get(key);
    if (existing !== undefined) return existing;

    const fmt = numFmtFor(style);
    let numFmtId = 0;
    if (typeof fmt === "number") numFmtId = fmt;
    else if (typeof fmt === "string") {
      let id = customCodes.get(fmt);
      if (id === undefined) customCodes.set(fmt, (id = 164 + customCodes.size));
      numFmtId = id;
    }

    let fontId = 0;
    if (style.bold || style.italic || style.underline || style.strike || style.fontSize || style.color) {
      const argb = style.color ? cssToArgb(style.color) : null;
      const fontXml =
        "<font>" +
        (style.bold ? "<b/>" : "") +
        (style.italic ? "<i/>" : "") +
        (style.underline ? "<u/>" : "") +
        (style.strike ? "<strike/>" : "") +
        (style.fontSize ? `<sz val="${style.fontSize * 0.75}"/>` : '<sz val="11"/>') +
        (argb ? `<color rgb="${argb}"/>` : "") +
        '<name val="Calibri"/></font>';
      const f = fontIdx.get(fontXml);
      if (f !== undefined) fontId = f;
      else {
        fontId = fonts.length;
        fonts.push(fontXml);
        fontIdx.set(fontXml, fontId);
      }
    }

    let fillId = 0;
    const bg = style.background ? cssToArgb(style.background) : null;
    if (bg) {
      const f = fillIdx.get(bg);
      if (f !== undefined) fillId = f;
      else {
        fillId = fills.length;
        fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/></patternFill></fill>`);
        fillIdx.set(bg, fillId);
      }
    }

    const align = style.align || style.valign || style.wrap;
    const alignment = align
      ? "<alignment" +
        (style.align ? ` horizontal="${style.align}"` : "") +
        (style.valign ? ` vertical="${style.valign === "middle" ? "center" : style.valign}"` : "") +
        (style.wrap ? ' wrapText="1"' : "") +
        "/>"
      : "";
    const xf =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"` +
      (numFmtId ? ' applyNumberFormat="1"' : "") +
      (fontId ? ' applyFont="1"' : "") +
      (fillId ? ' applyFill="1"' : "") +
      (alignment ? ` applyAlignment="1">${alignment}</xf>` : "/>");
    const idx = xfs.length;
    xfs.push(xf);
    xfIdx.set(key, idx);
    return idx;
  };

  for (const [ref, style] of Object.entries(snapshot.styles)) {
    const p = parseCellRef(ref);
    if (!p || Object.keys(style).length === 0) continue;
    maxRow = Math.max(maxRow, p.row);
    maxCol = Math.max(maxCol, p.col);
    put(p.row, p.col).styleIdx = internXf(style);
  }

  // Headless evaluation for cached formula values. Size well past the
  // used range (legacy Excel sheet dimensions at minimum): a direct ref
  // to an empty cell beyond the store bounds would evaluate to a spurious
  // #REF! instead of empty. The constructor stores plain counts, so large
  // bounds cost nothing; only explicit huge ranges would iterate more.
  const store = new GridStore(
    Math.max(maxRow + 101, 65536),
    Math.max(maxCol + 3, 256),
    100
  );
  store.setCells(changes, false);

  // ---- worksheet XML ----
  const cols = Object.entries(snapshot.colWidths)
    .map(([c, px]) => ({ col: Number(c), px }))
    .filter((e) => Number.isFinite(e.col) && e.col >= 0 && Number.isFinite(e.px))
    .sort((a, b) => a.col - b.col);
  const colsXml = cols.length
    ? "<cols>" +
      cols
        .map(
          (e) =>
            `<col min="${e.col + 1}" max="${e.col + 1}" width="${+(((e.px - 5) / 7).toFixed(4))}" customWidth="1"/>`
        )
        .join("") +
      "</cols>"
    : "";

  const rowsXml: string[] = [];
  for (const row of [...byCoord.keys()].sort((a, b) => a - b)) {
    const cells: string[] = [];
    const colMap = byCoord.get(row)!;
    for (const col of [...colMap.keys()].sort((a, b) => a - b)) {
      const out = colMap.get(col)!;
      const ref = formatCellRef(row, col);
      const sAttr = out.styleIdx ? ` s="${out.styleIdx}"` : "";
      if (out.raw === null) {
        cells.push(`<c r="${ref}"${sAttr}/>`);
        continue;
      }
      const rec = store.getCell(row, col);
      if (!rec) {
        // Raw present but rejected by the store (shouldn't happen): skip value.
        cells.push(`<c r="${ref}"${sAttr}/>`);
        continue;
      }
      if (rec.raw.startsWith("=")) {
        const f = `<f>${escXml(rec.raw.slice(1))}</f>`;
        if (rec.error) {
          cells.push(`<c r="${ref}"${sAttr} t="e">${f}<v>${escXml(rec.error)}</v></c>`);
        } else if (typeof rec.value === "number" && Number.isFinite(rec.value)) {
          cells.push(`<c r="${ref}"${sAttr}>${f}<v>${rec.value}</v></c>`);
        } else if (typeof rec.value === "boolean") {
          cells.push(`<c r="${ref}"${sAttr} t="b">${f}<v>${rec.value ? 1 : 0}</v></c>`);
        } else if (typeof rec.value === "string" && rec.value !== "") {
          cells.push(`<c r="${ref}"${sAttr} t="str">${f}<v>${escXml(rec.value)}</v></c>`);
        } else {
          cells.push(`<c r="${ref}"${sAttr}>${f}</c>`);
        }
      } else if (typeof rec.value === "number" && Number.isFinite(rec.value)) {
        cells.push(`<c r="${ref}"${sAttr}><v>${rec.value}</v></c>`);
      } else if (typeof rec.value === "boolean") {
        cells.push(`<c r="${ref}"${sAttr} t="b"><v>${rec.value ? 1 : 0}</v></c>`);
      } else {
        cells.push(
          `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escXml(rec.raw)}</t></is></c>`
        );
      }
    }
    rowsXml.push(`<row r="${row + 1}">${cells.join("")}</row>`);
  }

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    colsXml +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    "</worksheet>";

  // ---- styles XML ----
  const numFmtsXml = customCodes.size
    ? `<numFmts count="${customCodes.size}">` +
      [...customCodes]
        .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escXml(code)}"/>`)
        .join("") +
      "</numFmts>"
    : "";
  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    numFmtsXml +
    `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${escXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    "</workbook>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    "</Relationships>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_DOC_REL}/styles" Target="styles.xml"/>` +
    "</Relationships>";

  const enc = new TextEncoder();
  return createZip([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRels) },
    { name: "xl/styles.xml", data: enc.encode(stylesXml) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml) },
  ]);
}

// ---- reader ----

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("xlsx: malformed XML part");
  }
  return doc;
}

/** Resolve a relationship target against the directory of the source part. */
function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const out: string[] = [];
  for (const p of (baseDir ? baseDir.split("/") : []).concat(target.split("/"))) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Decode OOXML "_xHHHH_" character escapes. */
function decodeXEscapes(s: string): string {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/** Concatenated text of all <t> descendants (handles rich-text runs). */
function textOf(el: Element): string {
  let out = "";
  const ts = el.getElementsByTagName("t");
  for (let i = 0; i < ts.length; i++) out += ts[i].textContent ?? "";
  return decodeXEscapes(out);
}

const H_ALIGNS: HAlign[] = ["left", "center", "right"];
const V_ALIGNS: VAlign[] = ["top", "middle", "bottom"];

interface XfInfo {
  style: CellStyle;
  isDate: boolean;
}

/** Parse styles.xml into per-xf CellStyle records. */
function parseStyles(doc: Document): XfInfo[] {
  const codes = new Map<number, string>();
  for (const nf of Array.from(doc.getElementsByTagName("numFmt"))) {
    const id = Number(nf.getAttribute("numFmtId"));
    const code = nf.getAttribute("formatCode");
    if (Number.isFinite(id) && code !== null) codes.set(id, code);
  }

  const fontStyles: Partial<CellStyle>[] = [];
  const fontsEl = doc.getElementsByTagName("fonts")[0];
  if (fontsEl) {
    for (const font of Array.from(fontsEl.getElementsByTagName("font"))) {
      const s: Partial<CellStyle> = {};
      if (font.getElementsByTagName("b").length) s.bold = true;
      if (font.getElementsByTagName("i").length) s.italic = true;
      if (font.getElementsByTagName("u").length) s.underline = true;
      if (font.getElementsByTagName("strike").length) s.strike = true;
      const sz = Number(font.getElementsByTagName("sz")[0]?.getAttribute("val"));
      // 11pt is the Excel default; anything else maps to px. Theme/indexed
      // colors (no rgb attribute) are skipped by argbToCss returning null.
      if (Number.isFinite(sz) && sz > 0 && sz !== 11) s.fontSize = Math.round(sz / 0.75);
      const color = argbToCss(font.getElementsByTagName("color")[0]?.getAttribute("rgb") ?? null);
      if (color) s.color = color;
      fontStyles.push(s);
    }
  }

  const fillStyles: (string | null)[] = [];
  const fillsEl = doc.getElementsByTagName("fills")[0];
  if (fillsEl) {
    for (const fill of Array.from(fillsEl.getElementsByTagName("fill"))) {
      const pat = fill.getElementsByTagName("patternFill")[0];
      if (pat?.getAttribute("patternType") === "solid") {
        fillStyles.push(
          argbToCss(pat.getElementsByTagName("fgColor")[0]?.getAttribute("rgb") ?? null)
        );
      } else {
        fillStyles.push(null);
      }
    }
  }

  const xfInfos: XfInfo[] = [];
  const cellXfs = doc.getElementsByTagName("cellXfs")[0];
  if (cellXfs) {
    for (const xf of Array.from(cellXfs.getElementsByTagName("xf"))) {
      const style: CellStyle = {};
      const numFmtId = Number(xf.getAttribute("numFmtId") ?? "0");
      const fmt = numFmtToStyle(numFmtId, codes.get(numFmtId));
      if (fmt.numFmt) style.numFmt = fmt.numFmt;
      if (fmt.decimals !== undefined) style.decimals = fmt.decimals;
      Object.assign(style, fontStyles[Number(xf.getAttribute("fontId") ?? "-1")] ?? {});
      const bg = fillStyles[Number(xf.getAttribute("fillId") ?? "-1")] ?? null;
      if (bg) style.background = bg;
      const alignment = xf.getElementsByTagName("alignment")[0];
      if (alignment) {
        const h = alignment.getAttribute("horizontal") as HAlign | null;
        if (h && H_ALIGNS.includes(h)) style.align = h;
        const vRaw = alignment.getAttribute("vertical");
        const v = (vRaw === "center" ? "middle" : vRaw) as VAlign | null;
        if (v && V_ALIGNS.includes(v)) style.valign = v;
        const wrap = alignment.getAttribute("wrapText");
        if (wrap === "1" || wrap === "true") style.wrap = true;
      }
      xfInfos.push({
        style,
        isDate: style.numFmt === "date" || style.numFmt === "datetime",
      });
    }
  }
  return xfInfos;
}

/** Find a relationship target by type suffix in a parsed .rels document. */
function relTarget(rels: Document | null, typeSuffix: string): string | null {
  if (!rels) return null;
  for (const rel of Array.from(rels.getElementsByTagName("Relationship"))) {
    if (rel.getAttribute("Type")?.endsWith(typeSuffix)) return rel.getAttribute("Target");
  }
  return null;
}

/**
 * Parse the first worksheet of an .xlsx workbook into a GridSnapshot.
 * Values/formulas/styles/column widths are mapped to grid equivalents;
 * unsupported features degrade gracefully.
 */
export async function xlsxToSnapshot(
  data: ArrayBuffer | Uint8Array
): Promise<GridSnapshot> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const parts = await readZip(bytes);
  const dec = new TextDecoder();
  const getXml = (name: string): Document | null => {
    const part = parts.get(name);
    return part ? parseXml(dec.decode(part)) : null;
  };

  // Workbook part via package rels (fallback: conventional path).
  const rootRels = getXml("_rels/.rels");
  const workbookPath =
    resolvePath("", relTarget(rootRels, "/officeDocument") ?? "xl/workbook.xml");
  const workbook = getXml(workbookPath);
  if (!workbook) throw new Error("xlsx: workbook part not found");
  const wbDir = workbookPath.includes("/")
    ? workbookPath.slice(0, workbookPath.lastIndexOf("/"))
    : "";
  const date1904 =
    ["1", "true"].includes(
      workbook.getElementsByTagName("workbookPr")[0]?.getAttribute("date1904") ?? ""
    );

  // First sheet in workbook document order -> its worksheet part.
  const wbRelsName = wbDir ? `${wbDir}/_rels/workbook.xml.rels` : "_rels/workbook.xml.rels";
  const wbRels = getXml(wbRelsName);
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  let sheetPath: string | null = null;
  const sheetRelId =
    firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttributeNS(NS_DOC_REL, "id");
  if (sheetRelId && wbRels) {
    for (const rel of Array.from(wbRels.getElementsByTagName("Relationship"))) {
      if (rel.getAttribute("Id") === sheetRelId) {
        sheetPath = resolvePath(wbDir, rel.getAttribute("Target") ?? "");
        break;
      }
    }
  }
  const sheet = getXml(sheetPath ?? `${wbDir}/worksheets/sheet1.xml`);
  if (!sheet) throw new Error("xlsx: worksheet part not found");

  // Shared strings and styles (both optional).
  const sstTarget = relTarget(wbRels, "/sharedStrings");
  const sstDoc = getXml(sstTarget ? resolvePath(wbDir, sstTarget) : `${wbDir}/sharedStrings.xml`);
  const sharedStrings: string[] = [];
  if (sstDoc) {
    for (const si of Array.from(sstDoc.getElementsByTagName("si"))) {
      sharedStrings.push(textOf(si));
    }
  }
  const stylesTarget = relTarget(wbRels, "/styles");
  const stylesDoc = getXml(stylesTarget ? resolvePath(wbDir, stylesTarget) : `${wbDir}/styles.xml`);
  const xfInfos = stylesDoc ? parseStyles(stylesDoc) : [];

  const cells: Record<string, string> = {};
  const styles: Record<string, CellStyle> = {};
  const colWidths: Record<number, number> = {};

  // Column widths (character units -> px, inverse of the writer formula).
  for (const col of Array.from(sheet.getElementsByTagName("col"))) {
    const width = Number(col.getAttribute("width"));
    const custom = col.getAttribute("customWidth");
    if (!Number.isFinite(width) || !(custom === "1" || custom === "true")) continue;
    const min = Number(col.getAttribute("min"));
    const max = Number(col.getAttribute("max"));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min > 1000) continue;
    for (let c = min - 1; c <= max - 1 && c < 10000; c++) {
      if (c >= 0) colWidths[c] = Math.round(width * 7 + 5);
    }
  }

  // Shared formula masters: si -> definition text + host cell.
  const sharedMasters = new Map<string, { text: string; row: number; col: number }>();

  /** Literal string cell values must never import as formulas. */
  const guard = (s: string): string => (s.startsWith("=") ? "'" + s : s);

  let rowIdx = -1;
  for (const rowEl of Array.from(sheet.getElementsByTagName("row"))) {
    const r = Number(rowEl.getAttribute("r"));
    rowIdx = Number.isFinite(r) && r >= 1 ? r - 1 : rowIdx + 1;
    let colIdx = -1;
    for (const c of Array.from(rowEl.getElementsByTagName("c"))) {
      const refAttr = c.getAttribute("r");
      const parsed = refAttr ? parseCellRef(refAttr) : null;
      const row = parsed ? parsed.row : rowIdx;
      const col = parsed ? parsed.col : colIdx + 1;
      colIdx = col;
      if (row < 0 || col < 0) continue;
      const ref = formatCellRef(row, col);

      // Style first: it applies even to valueless cells.
      const s = Number(c.getAttribute("s") ?? "-1");
      const xf = xfInfos[s];
      if (xf && Object.keys(xf.style).length > 0) styles[ref] = { ...xf.style };

      const t = c.getAttribute("t") ?? "n";
      const vEl = c.getElementsByTagName("v")[0];
      const v = vEl?.textContent ?? "";

      // Formulas win over cached values; the grid re-evaluates them.
      const fEl = c.getElementsByTagName("f")[0];
      if (fEl) {
        const fText = fEl.textContent ?? "";
        if (fEl.getAttribute("t") === "shared") {
          const si = fEl.getAttribute("si") ?? "";
          if (fText !== "") {
            sharedMasters.set(si, { text: fText, row, col });
            cells[ref] = "=" + fText;
            continue;
          }
          const master = sharedMasters.get(si);
          if (master) {
            cells[ref] = adjustFormula(
              "=" + master.text,
              row - master.row,
              col - master.col,
              XLSX_MAX_ROWS,
              XLSX_MAX_COLS
            );
            continue;
          }
          // Follower before master (invalid file): fall through to value.
        } else if (fText !== "") {
          cells[ref] = "=" + fText;
          continue;
        }
      }

      if (t === "s") {
        const str = sharedStrings[Number(v)];
        if (str !== undefined && str !== "") cells[ref] = guard(str);
      } else if (t === "inlineStr") {
        const isEl = c.getElementsByTagName("is")[0];
        const str = isEl ? textOf(isEl) : "";
        if (str !== "") cells[ref] = guard(str);
      } else if (t === "str") {
        if (v !== "") cells[ref] = guard(decodeXEscapes(v));
      } else if (t === "b") {
        cells[ref] = v === "1" || v.toLowerCase() === "true" ? "TRUE" : "FALSE";
      } else if (t === "e") {
        // Cached error with no formula: keep the style, drop the value.
      } else if (v !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) {
          cells[ref] = String(date1904 && xf?.isDate ? n + 1462 : n);
        }
      }
    }
  }

  return { cells, styles, colWidths };
}
