// Excel-style date/time serial numbers: integer part = days since the
// epoch 1899-12-30 (UTC), fractional part = fraction of a 24h day. All
// conversions are UTC-only so rendering/parsing never shifts with the
// host timezone or DST. No new CellValue type: a date cell is a plain
// number.
// Features: dateToSerial/serialToUTCParts (round-trip conversion with
// second-level rounding + carry), formatDateSerial (date / time /
// datetime / duration rendering), parseDateTimeLiteral (strict ISO/US
// date, 12h/24h time, and combined literal parsing with calendar/clock
// validation).
// Recent changes: initial implementation.

const EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/** Days since the Excel epoch (1899-12-30 UTC) plus a day-fraction for time. */
export function dateToSerial(
  y: number,
  m: number,
  d: number,
  hh = 0,
  mm = 0,
  ss = 0
): number {
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss);
  return (ms - EPOCH_MS) / MS_PER_DAY;
}

export interface DateTimeParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

/**
 * Inverse of dateToSerial. Seconds are rounded to the nearest whole
 * second (fractional serials carry sub-second noise), with carry into
 * minutes/hours/days so e.g. 23:59:59.6 rounds up to the next day.
 */
export function serialToUTCParts(serial: number): DateTimeParts {
  const ms = Math.round(EPOCH_MS + serial * MS_PER_DAY);
  const rounded = Math.round(ms / 1000) * 1000;
  const dt = new Date(rounded);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    hh: dt.getUTCHours(),
    mm: dt.getUTCMinutes(),
    ss: dt.getUTCSeconds(),
  };
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function formatDatePart(p: DateTimeParts): string {
  return `${p.m}/${p.d}/${p.y}`;
}

function formatTimePart12(p: DateTimeParts): string {
  const ampm = p.hh < 12 ? "AM" : "PM";
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${h12}:${pad2(p.mm)}:${pad2(p.ss)} ${ampm}`;
}

function formatTimePart24(p: DateTimeParts): string {
  return `${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`;
}

export type DateFmtKind = "date" | "time" | "datetime" | "duration";

/**
 * Render a serial per kind. Returns null when the value cannot be a
 * valid serial for that kind (date/time/datetime require a finite,
 * non-negative serial; duration requires only a finite serial and
 * renders negatives with a leading "-").
 */
export function formatDateSerial(v: number, kind: DateFmtKind): string | null {
  if (kind === "duration") {
    if (!Number.isFinite(v)) return null;
    const neg = v < 0;
    const totalSeconds = Math.round(Math.abs(v) * 86400);
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    return (neg ? "-" : "") + `${hh}:${pad2(mm)}:${pad2(ss)}`;
  }
  if (!Number.isFinite(v) || v < 0) return null;
  const p = serialToUTCParts(v);
  switch (kind) {
    case "date":
      return formatDatePart(p);
    case "time":
      return formatTimePart12(p);
    case "datetime":
      return `${formatDatePart(p)} ${formatTimePart24(p)}`;
  }
}

// ---- literal parsing ----

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Validate a calendar date; returns {y,m,d} or null. */
function matchDate(
  text: string
): { y: number; m: number; d: number } | null {
  let y: number, m: number, d: number;
  const iso = ISO_DATE.exec(text);
  if (iso) {
    y = +iso[1];
    m = +iso[2];
    d = +iso[3];
  } else {
    const us = US_DATE.exec(text);
    if (!us) return null;
    m = +us[1];
    d = +us[2];
    y = +us[3];
  }
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Validate a clock time; returns {hh,mm,ss} or null. */
function matchTime(
  text: string
): { hh: number; mm: number; ss: number } | null {
  const m = TIME.exec(text);
  if (!m) return null;
  let hh = +m[1];
  const mm = +m[2];
  const ss = m[3] ? +m[3] : 0;
  const ampm = m[4]?.toLowerCase();
  if (mm > 59 || ss > 59) return null;
  if (ampm) {
    if (hh < 1 || hh > 12) return null;
    if (ampm === "am") hh = hh === 12 ? 0 : hh;
    else hh = hh === 12 ? 12 : hh + 12;
  } else if (hh > 23) {
    return null;
  }
  return { hh, mm, ss };
}

export interface ParsedDateTime {
  serial: number;
  fmt: "date" | "time" | "datetime";
}

/**
 * Parse a strict, unambiguous date/time/datetime literal. Returns null
 * for anything else (including out-of-range calendar/clock values),
 * leaving the raw text as plain text.
 *
 * Whole-string date and time forms are tried first: a bare time like
 * "3:59 PM" contains a space (before AM/PM) but must NOT be mistaken for
 * a failed date+time split, since matchTime's own regex already accounts
 * for that space. Only when neither whole-string form matches do we look
 * for a "<date> <time>" combination.
 */
export function parseDateTimeLiteral(trimmed: string): ParsedDateTime | null {
  if (trimmed === "") return null;

  const wholeDate = matchDate(trimmed);
  if (wholeDate) {
    return { serial: dateToSerial(wholeDate.y, wholeDate.m, wholeDate.d), fmt: "date" };
  }
  const wholeTime = matchTime(trimmed);
  if (wholeTime) {
    return {
      serial: dateToSerial(1899, 12, 30, wholeTime.hh, wholeTime.mm, wholeTime.ss),
      fmt: "time",
    };
  }

  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) {
    const datePart = trimmed.slice(0, spaceIdx);
    const timePart = trimmed.slice(spaceIdx + 1).trim();
    const date = matchDate(datePart);
    const time = date ? matchTime(timePart) : null;
    if (date && time) {
      return {
        serial: dateToSerial(date.y, date.m, date.d, time.hh, time.mm, time.ss),
        fmt: "datetime",
      };
    }
  }
  return null;
}
