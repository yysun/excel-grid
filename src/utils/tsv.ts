// Delimiter-separated-values serialization: TSV for clipboard interop with
// Excel Web / Google Sheets, CSV for file import/export.
// Features: encode a 2-D string matrix (quoting cells that contain the
// delimiter, newlines, or quotes) and parse text back to a matrix,
// honoring RFC-4180-style double-quote escaping the way Sheets emits it.
// Rows are joined with "\n" on encode; "\r\n" and "\r" are normalized on
// parse.
// Recent changes: generalized the TSV encoder/parser by delimiter and
// added toCSV/parseCSV for the demo's Open CSV / Save CSV file actions.

function encodeCell(v: string, delim: string): string {
  return v.includes(delim) || /[\n\r"]/.test(v)
    ? '"' + v.replace(/"/g, '""') + '"'
    : v;
}

function encodeDelimited(rows: string[][], delim: string): string {
  return rows.map((r) => r.map((c) => encodeCell(c, delim)).join(delim)).join("\n");
}

/** Parse delimiter-separated text into a row-major matrix. Handles quoted cells with embedded delimiters/newlines and "" escapes. */
function parseDelimited(text: string, delim: string): string[][] {
  // Normalize line endings; a single trailing newline (as Excel adds) is dropped.
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' && field === "") {
      // Quoted field: read until the closing quote (doubled quotes are escapes).
      i++;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += src[i++];
        }
      }
    } else if (ch === delim) {
      pushField();
      i++;
    } else if (ch === "\n") {
      pushRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  // Final field/row unless the text ended with a newline (already pushed).
  if (field !== "" || row.length > 0 || src === "" || !src.endsWith("\n")) {
    pushRow();
  }
  return rows;
}

/** Serialize a row-major matrix to TSV. */
export function toTSV(rows: string[][]): string {
  return encodeDelimited(rows, "\t");
}

/** Parse TSV text into a row-major matrix. */
export function parseTSV(text: string): string[][] {
  return parseDelimited(text, "\t");
}

/** Serialize a row-major matrix to CSV (RFC-4180-style quoting, LF rows). */
export function toCSV(rows: string[][]): string {
  return encodeDelimited(rows, ",");
}

/** Parse CSV text into a row-major matrix. */
export function parseCSV(text: string): string[][] {
  return parseDelimited(text, ",");
}
