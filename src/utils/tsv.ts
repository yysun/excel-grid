// TSV (tab-separated values) serialization for clipboard interop with
// Excel Web / Google Sheets.
// Features: encode a 2-D string matrix to TSV (quoting cells that contain
// tabs/newlines/quotes) and parse TSV text back to a matrix, honoring
// double-quote escaping the way Sheets emits it.
// Recent changes: initial implementation.

function encodeCell(v: string): string {
  return /[\t\n\r"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/** Serialize a row-major matrix to TSV. */
export function toTSV(rows: string[][]): string {
  return rows.map((r) => r.map(encodeCell).join("\t")).join("\n");
}

/** Parse TSV text into a row-major matrix. Handles quoted cells with embedded tabs/newlines and "" escapes. */
export function parseTSV(text: string): string[][] {
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
    } else if (ch === "\t") {
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
