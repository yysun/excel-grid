// ContextMenu: the right-click menu used by ExcelGrid.
// Features: fixed-position menu clamped to the viewport (measured after
// mount), action + separator items with disabled states, closes on Escape,
// outside mousedown, scroll (capture phase), window resize, or after an
// item runs. Purely presentational: item lists are built by ExcelGrid.
// Recent changes: initial implementation for the context-menus story.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { label: string; onClick: () => void; disabled?: boolean }
  | "sep";

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

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
    // Any key closes: the grid underneath still handles it (e.g. typing
    // opens the editor), and a stale menu over an editor is confusing.
    const onKeyDown = () => onClose();
    const onScrollOrResize = () => onClose();
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="xg-menu"
      style={{
        left: pos.left,
        top: pos.top,
        visibility: pos.ready ? undefined : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="xg-menu-sep" />
        ) : (
          <button
            key={i}
            type="button"
            className="xg-menu-item"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
