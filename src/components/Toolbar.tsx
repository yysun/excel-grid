// Toolbar: WeCom (企业微信表格)-style minimal formatting toolbar for ExcelGrid.
// Features: undo/redo, clear format, percent/thousands/decimal number
// formats, font-size dropdown, bold/italic/underline/strikethrough toggles,
// text & fill color palettes, horizontal + vertical alignment, text wrap,
// filter-mode toggle, freeze-panes popover, and quick SUM — all operating
// on the current selection via GridStore, with pressed states derived from
// the active cell's style. English tooltips, inline SVG icons, no external
// dependencies. mousedown is prevented so grid focus is kept.
// Recent changes: added a Google Sheets-style "123" format dropdown
// (Automatic / Number / Percent / Scientific / Currency with example
// output and a check on the active format); Automatic clears numFmt +
// decimals in one undoable patch; bumpDecimals now starts from the active
// format's default digit count so "increase" never lowers it.

import { useEffect, useRef, useState } from "react";
import type { GridStore, RawChange } from "../state/GridStore";
import type {
  CellCoord,
  CellRange,
  CellStyle,
  HAlign,
  NumFmt,
  VAlign,
} from "../types";
import { colToLetters } from "../utils/cellRef";

const FONT_SIZES = [10, 11, 12, 14, 16, 18, 24];

const PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#d9d9d9", "#efefef", "#ffffff",
  "#e60000", "#ff9900", "#f9d900", "#00b050", "#00b0f0", "#1a73e8", "#7030a0", "#f06292",
  "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9", "#ead1dc",
];

type Popover = "fmt" | "size" | "color" | "fill" | "freeze" | null;

/** Rows of the "More formats" dropdown; fmt undefined = Automatic. */
const FORMAT_ITEMS: Array<{
  fmt: NumFmt | undefined;
  label: string;
  example?: string;
}> = [
  { fmt: undefined, label: "Automatic" },
  { fmt: "number", label: "Number", example: "1,000.12" },
  { fmt: "percent", label: "Percent", example: "10.12%" },
  { fmt: "scientific", label: "Scientific", example: "1.01E+3" },
  { fmt: "currency", label: "Currency", example: "$1,000.12" },
];

/** Formats whose default display uses 2 fraction digits. */
const FMT_DEFAULT_DECIMALS: Partial<Record<NumFmt, number>> = {
  number: 2,
  currency: 2,
  scientific: 2,
};

interface ToolbarProps {
  store: GridStore;
  selRange: CellRange;
  active: CellCoord;
  /** Total row count of the grid (bounds check for quick sum). */
  rows: number;
}

export function Toolbar({ store, selRange, active, rows }: ToolbarProps) {
  const [open, setOpen] = useState<Popover>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeStyle: CellStyle = store.getStyle(active.row, active.col) ?? {};

  const toggleFlag = (key: "bold" | "italic" | "underline" | "strike") => {
    store.applyStyle(selRange, {
      [key]: activeStyle[key] ? undefined : true,
    } as Partial<CellStyle>);
  };

  const setAlign = (align: HAlign) => {
    store.applyStyle(selRange, {
      align: activeStyle.align === align ? undefined : align,
    });
  };

  const setVAlign = (valign: VAlign) => {
    store.applyStyle(selRange, {
      valign: activeStyle.valign === valign ? undefined : valign,
    });
  };

  const toggleWrap = () => {
    store.applyStyle(selRange, { wrap: activeStyle.wrap ? undefined : true });
  };

  const toggleFilter = () => {
    if (store.hasFilter()) {
      store.clearFilterCols();
    } else {
      const cols: number[] = [];
      for (let c = selRange.startCol; c <= selRange.endCol; c++) cols.push(c);
      store.setFilterCols(cols);
    }
  };

  const frozen = store.getFrozenRows() > 0 || store.getFrozenCols() > 0;

  const freezeAction = (action: () => void) => {
    action();
    setOpen(null);
  };

  const toggleFmt = (fmt: NumFmt) => {
    store.applyStyle(selRange, {
      numFmt: activeStyle.numFmt === fmt ? undefined : fmt,
    });
  };

  const bumpDecimals = (delta: number) => {
    const base =
      activeStyle.decimals ??
      (activeStyle.numFmt ? FMT_DEFAULT_DECIMALS[activeStyle.numFmt] ?? 0 : 0);
    const next = Math.min(10, Math.max(0, base + delta));
    store.applyStyle(selRange, { decimals: next });
  };

  const applyFmt = (fmt: NumFmt | undefined) => {
    store.applyStyle(
      selRange,
      fmt === undefined
        ? { numFmt: undefined, decimals: undefined }
        : { numFmt: fmt }
    );
    setOpen(null);
  };

  const applyColor = (key: "color" | "background", value?: string) => {
    store.applyStyle(selRange, { [key]: value } as Partial<CellStyle>);
    setOpen(null);
  };

  const applyFontSize = (n: number) => {
    store.applyStyle(selRange, { fontSize: n });
    setOpen(null);
  };

  const quickSum = () => {
    const row = selRange.endRow + 1;
    if (row >= rows) return;
    const changes: RawChange[] = [];
    for (let col = selRange.startCol; col <= selRange.endCol; col++) {
      const c = colToLetters(col);
      changes.push({
        row,
        col,
        raw: `=SUM(${c}${selRange.startRow + 1}:${c}${selRange.endRow + 1})`,
      });
    }
    store.setCells(changes);
  };

  const btn = (
    title: string,
    opts: {
      on?: boolean;
      disabled?: boolean;
      onClick: () => void;
      className?: string;
    },
    children: React.ReactNode
  ) => (
    <button
      type="button"
      className={
        "xg-tb-btn" +
        (opts.on ? " xg-tb-btn--on" : "") +
        (opts.className ? " " + opts.className : "")
      }
      title={title}
      disabled={opts.disabled}
      onClick={opts.onClick}
    >
      {children}
    </button>
  );

  const palette = (key: "color" | "background") => (
    <div className="xg-tb-pop">
      <button
        type="button"
        className="xg-tb-reset"
        onClick={() => applyColor(key, undefined)}
      >
        Automatic
      </button>
      <div className="xg-tb-palette">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className="xg-tb-swatch"
            style={{ background: c }}
            title={c}
            onClick={() => applyColor(key, c)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="xg-toolbar"
      onMouseDown={(e) => e.preventDefault()}
    >
      {btn("Undo", { disabled: !store.canUndo(), onClick: () => store.undo() }, <IconUndo />)}
      {btn("Redo", { disabled: !store.canRedo(), onClick: () => store.redo() }, <IconRedo />)}
      <span className="xg-tb-sep" />
      {btn("Clear formatting", { onClick: () => store.clearFormat(selRange) }, <IconEraser />)}
      <span className="xg-tb-sep" />
      <div className="xg-tb-group">
        {btn("More formats", { on: open === "fmt", onClick: () => setOpen(open === "fmt" ? null : "fmt") }, (
          <>
            123
            <IconCaret />
          </>
        ))}
        {open === "fmt" && (
          <div className="xg-tb-pop xg-tb-menu">
            {FORMAT_ITEMS.map((item) => {
              // A stored "general" means no effective format, i.e. Automatic.
              const current =
                activeStyle.numFmt === "general" ? undefined : activeStyle.numFmt;
              return (
                <button
                  key={item.label}
                  type="button"
                  className="xg-tb-menu-item xg-tb-fmt-item"
                  onClick={() => applyFmt(item.fmt)}
                >
                  <span className="xg-tb-fmt-check">
                    {current === item.fmt ? "✓" : ""}
                  </span>
                  <span>{item.label}</span>
                  {item.example && (
                    <span className="xg-tb-fmt-example">{item.example}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {btn("Percent format", { on: activeStyle.numFmt === "percent", onClick: () => toggleFmt("percent") }, "%")}
      {btn("Thousands separator", { on: activeStyle.numFmt === "thousands", onClick: () => toggleFmt("thousands") }, ",")}
      {btn("Increase decimal places", { onClick: () => bumpDecimals(1), className: "xg-tb-btn--sm" }, ".00+")}
      {btn("Decrease decimal places", { onClick: () => bumpDecimals(-1), className: "xg-tb-btn--sm" }, ".0-")}
      <span className="xg-tb-sep" />
      <div className="xg-tb-group">
        {btn("Font size", { on: open === "size", onClick: () => setOpen(open === "size" ? null : "size") }, (
          <>
            {activeStyle.fontSize ?? 13}
            <IconCaret />
          </>
        ))}
        {open === "size" && (
          <div className="xg-tb-pop xg-tb-sizes">
            {FONT_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                className={
                  "xg-tb-size-item" +
                  (activeStyle.fontSize === n ? " xg-tb-size-item--on" : "")
                }
                onClick={() => applyFontSize(n)}
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="xg-tb-sep" />
      {btn("Bold", { on: !!activeStyle.bold, onClick: () => toggleFlag("bold"), className: "xg-tb-b" }, "B")}
      {btn("Italic", { on: !!activeStyle.italic, onClick: () => toggleFlag("italic"), className: "xg-tb-i" }, "I")}
      {btn("Underline", { on: !!activeStyle.underline, onClick: () => toggleFlag("underline"), className: "xg-tb-u" }, "U")}
      {btn("Strikethrough", { on: !!activeStyle.strike, onClick: () => toggleFlag("strike"), className: "xg-tb-s" }, "S")}
      <span className="xg-tb-sep" />
      <div className="xg-tb-group">
        {btn("Text color", { on: open === "color", onClick: () => setOpen(open === "color" ? null : "color") }, (
          <span className="xg-tb-A">
            A
            <span
              className="xg-tb-colorbar"
              style={{ background: activeStyle.color ?? "#e60000" }}
            />
          </span>
        ))}
        {open === "color" && palette("color")}
      </div>
      <div className="xg-tb-group">
        {btn("Fill color", { on: open === "fill", onClick: () => setOpen(open === "fill" ? null : "fill") }, (
          <span className="xg-tb-A">
            <IconBucket />
            <span
              className="xg-tb-colorbar"
              style={{ background: activeStyle.background ?? "#f9d900" }}
            />
          </span>
        ))}
        {open === "fill" && palette("background")}
      </div>
      <span className="xg-tb-sep" />
      {btn("Align left", { on: activeStyle.align === "left", onClick: () => setAlign("left") }, <IconAlign kind="left" />)}
      {btn("Align center", { on: activeStyle.align === "center", onClick: () => setAlign("center") }, <IconAlign kind="center" />)}
      {btn("Align right", { on: activeStyle.align === "right", onClick: () => setAlign("right") }, <IconAlign kind="right" />)}
      <span className="xg-tb-sep" />
      {btn("Align top", { on: activeStyle.valign === "top", onClick: () => setVAlign("top") }, <IconVAlign kind="top" />)}
      {btn("Align middle", { on: activeStyle.valign === "middle", onClick: () => setVAlign("middle") }, <IconVAlign kind="middle" />)}
      {btn("Align bottom", { on: activeStyle.valign === "bottom", onClick: () => setVAlign("bottom") }, <IconVAlign kind="bottom" />)}
      {btn("Wrap text", { on: !!activeStyle.wrap, onClick: toggleWrap }, <IconWrap />)}
      <span className="xg-tb-sep" />
      {btn("Filter", { on: store.hasFilter(), onClick: toggleFilter }, <IconFilter />)}
      <div className="xg-tb-group">
        {btn("Freeze panes", { on: open === "freeze" || frozen, onClick: () => setOpen(open === "freeze" ? null : "freeze") }, (
          <>
            <IconFreeze />
            <IconCaret />
          </>
        ))}
        {open === "freeze" && (
          <div className="xg-tb-pop xg-tb-menu">
            <button
              type="button"
              className="xg-tb-menu-item"
              onClick={() => freezeAction(() => store.setFrozenRows(selRange.endRow + 1))}
            >
              Freeze up to row {selRange.endRow + 1}
            </button>
            <button
              type="button"
              className="xg-tb-menu-item"
              onClick={() => freezeAction(() => store.setFrozenCols(selRange.endCol + 1))}
            >
              Freeze up to column {colToLetters(selRange.endCol)}
            </button>
            <button
              type="button"
              className="xg-tb-menu-item"
              disabled={!frozen}
              onClick={() =>
                freezeAction(() => {
                  store.setFrozenRows(0);
                  store.setFrozenCols(0);
                })
              }
            >
              Unfreeze
            </button>
          </div>
        )}
      </div>
      <span className="xg-tb-sep" />
      {btn("Sum", { onClick: quickSum, className: "xg-tb-sum" }, "Σ")}
    </div>
  );
}

// ---- inline icons (16x16, stroke = currentColor) ----

function IconUndo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 6.5H9a3.5 3.5 0 0 1 0 7H5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M6 3.5 3 6.5l3 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRedo() {
  return (
    <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
      <IconUndo />
    </span>
  );
}

function IconEraser() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9.2 3.1 3.7 8.6a1.2 1.2 0 0 0 0 1.7l2.2 2.2h2.6l4.2-4.2a1.2 1.2 0 0 0 0-1.7l-1.8-1.8a1.2 1.2 0 0 0-1.7 0Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="m6.3 6 3.8 3.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 13.5h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconCaret() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d="m2.5 4 2.5 2.5L7.5 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBucket() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M7 2.2 12 7.1a1 1 0 0 1 0 1.4L9.2 11.3a2 2 0 0 1-2.8 0L4 8.9a2 2 0 0 1 0-2.8l3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M13.2 9.8s.9 1.2.9 1.9a.9.9 0 0 1-1.8 0c0-.7.9-1.9.9-1.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconAlign({ kind }: { kind: HAlign }) {
  const mid = kind === "left" ? "M3 7h6M3 13h6" : kind === "center" ? "M5 7h6M5 13h6" : "M7 7h6M7 13h6";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4h10M3 10h10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d={mid} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Two text lines pinned to the top / middle / bottom of a cell box. */
function IconVAlign({ kind }: { kind: VAlign }) {
  const lines =
    kind === "top" ? "M5 5h6M5 7.5h6" : kind === "middle" ? "M5 6.8h6M5 9.2h6" : "M5 8.5h6M5 11h6";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d={lines} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconWrap() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 4h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M3 8h7.5a2.25 2.25 0 0 1 0 4.5H8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="m9.5 10.5-2 2 2 2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 12.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconFilter() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h11L9.5 8.6v4l-3-1.4V8.6L2.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Cell box with the frozen first row/column separated by inner lines. */
function IconFreeze() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M2.5 6h11M6 2.5v11" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
