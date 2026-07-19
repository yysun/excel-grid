// FilterPopup: Excel-style column filter value picker used by ExcelGrid.
// Features: fixed-position popup anchored under a column header's filter
// button and clamped to the viewport; lists the column's distinct
// used-range values (via GridStore.getColumnValues) with checkboxes, a
// case-insensitive search box, a tri-state "Select all", and OK / Cancel.
// Draft checked state is local: OK commits through setColFilter (a full
// selection commits null, clearing the filter), Cancel / outside mousedown
// / Escape / viewport scroll / resize discard. OK is disabled when nothing
// is checked (an empty filter would hide every data row). mousedown is
// prevented outside the search input so the grid keeps keyboard focus.
// Recent changes: initial implementation for the column-filter-popup story.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GridStore } from "../state/GridStore";

export interface FilterPopupProps {
  store: GridStore;
  col: number;
  /** Anchor point: popup's top-left corner (viewport coordinates). */
  x: number;
  y: number;
  onClose: () => void;
}

export function FilterPopup({ store, col, x, y, onClose }: FilterPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [search, setSearch] = useState("");

  // Snapshot the value list once per open; edits while open are rare and
  // the draft is committed against keys, which tolerate list changes.
  const [values] = useState(() => store.getColumnValues(col));
  const [checked, setChecked] = useState<Set<string>>(
    () => store.getColFilter(col) ?? new Set(values.map((v) => v.key))
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(0, Math.min(y, window.innerHeight - height - 4)),
      ready: true,
    });
  }, [x, y]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Like ContextMenu: a scrolled/resized viewport strands the fixed-
    // position popup away from its anchor button, so close instead.
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
        return; // Scrolling the value list itself keeps the popup open.
      }
      onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const allChecked = checked.size === values.length;
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = checked.size > 0 && !allChecked;
    }
  }, [checked, allChecked]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(values.map((v) => v.key)));
  };

  // Like Excel: an empty selection would hide every data row, so OK is
  // disabled instead of committing it.
  const apply = () => {
    if (checked.size === 0) return;
    store.setColFilter(col, allChecked ? null : checked);
    onClose();
  };

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? values.filter((v) =>
        (v.key === "" ? "(blanks)" : v.label.toLowerCase()).includes(needle)
      )
    : values;

  return (
    <div
      ref={ref}
      className="xg-filter-pop"
      style={{
        left: pos.left,
        top: pos.top,
        visibility: pos.ready ? undefined : "hidden",
      }}
      // Keep grid focus except when clicking into the search input.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement) || e.target.type !== "text") {
          e.preventDefault();
        }
        e.stopPropagation();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <input
        type="text"
        className="xg-filter-search"
        placeholder="Search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
      />
      <label className="xg-filter-item xg-filter-all">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
        />
        Select all
      </label>
      <div className="xg-filter-list">
        {visible.map((v) => (
          <label key={v.key} className="xg-filter-item">
            <input
              type="checkbox"
              checked={checked.has(v.key)}
              onChange={() => toggle(v.key)}
            />
            <span className={v.key === "" ? "xg-filter-blank" : undefined}>
              {v.key === "" ? "(Blanks)" : v.label}
            </span>
            <span className="xg-filter-count">{v.count}</span>
          </label>
        ))}
        {visible.length === 0 && (
          <div className="xg-filter-empty">No matches</div>
        )}
      </div>
      <div className="xg-filter-foot">
        <button
          type="button"
          className="xg-filter-btn xg-filter-btn--ok"
          disabled={checked.size === 0}
          onClick={apply}
        >
          OK
        </button>
        <button type="button" className="xg-filter-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
