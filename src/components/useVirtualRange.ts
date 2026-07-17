// Virtual windowing math for the grid.
// Features: computes visible row/column index windows (with overscan) from
// scroll offsets, fixed row height, and variable column widths via a
// prefix-sum offset array with binary search.
// Recent changes: initial implementation.

import { useMemo } from "react";

export interface ColMetrics {
  /** offsets[i] = x position of column i; offsets[colCount] = total width. */
  offsets: number[];
  totalWidth: number;
  colAtX(x: number): number;
}

export function buildColMetrics(widths: number[]): ColMetrics {
  const offsets = new Array<number>(widths.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < widths.length; i++) offsets[i + 1] = offsets[i] + widths[i];
  const totalWidth = offsets[widths.length];
  const colAtX = (x: number): number => {
    if (x <= 0) return 0;
    if (x >= totalWidth) return widths.length - 1;
    let lo = 0;
    let hi = widths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return { offsets, totalWidth, colAtX };
}

export interface VirtualWindow {
  rowStart: number;
  rowEnd: number; // inclusive
  colStart: number;
  colEnd: number; // inclusive
}

const OVERSCAN = 3;

export function useVirtualRange(
  scrollTop: number,
  scrollLeft: number,
  viewportWidth: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  metrics: ColMetrics
): VirtualWindow {
  return useMemo(() => {
    const rowStart = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const rowEnd = Math.min(
      rowCount - 1,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN
    );
    const colStart = Math.max(0, metrics.colAtX(scrollLeft) - OVERSCAN);
    const colEnd = Math.min(
      metrics.offsets.length - 2,
      metrics.colAtX(scrollLeft + viewportWidth) + OVERSCAN
    );
    return { rowStart, rowEnd, colStart, colEnd };
  }, [scrollTop, scrollLeft, viewportWidth, viewportHeight, rowHeight, rowCount, metrics]);
}
