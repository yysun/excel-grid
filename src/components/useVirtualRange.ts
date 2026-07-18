// Virtual windowing math for the grid.
// Features: computes visible row/column index windows (with overscan) from
// scroll offsets and axis metrics — prefix-sum offset arrays with binary
// search over variable sizes. Zero-size entries (hidden rows/cols) are
// naturally skipped by the search.
// Recent changes: generalized column metrics to axis-neutral AxisMetrics and
// switched rows from uniform heights to metrics (hidden rows support).

import { useMemo } from "react";

export interface AxisMetrics {
  /** offsets[i] = position of entry i; offsets[count] = total size. */
  offsets: number[];
  total: number;
  /** Index of the entry containing position p (zero-size entries skipped). */
  indexAt(p: number): number;
}

export function buildAxisMetrics(sizes: number[]): AxisMetrics {
  const offsets = new Array<number>(sizes.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < sizes.length; i++) offsets[i + 1] = offsets[i] + sizes[i];
  const total = offsets[sizes.length];
  const indexAt = (p: number): number => {
    if (p <= 0) return 0;
    if (p >= total) return sizes.length - 1;
    let lo = 0;
    let hi = sizes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return { offsets, total, indexAt };
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
  rowMetrics: AxisMetrics,
  colMetrics: AxisMetrics
): VirtualWindow {
  return useMemo(() => {
    const rowCount = rowMetrics.offsets.length - 1;
    const colCount = colMetrics.offsets.length - 1;
    const rowStart = Math.max(0, rowMetrics.indexAt(scrollTop) - OVERSCAN);
    const rowEnd = Math.min(
      rowCount - 1,
      rowMetrics.indexAt(scrollTop + viewportHeight) + OVERSCAN
    );
    const colStart = Math.max(0, colMetrics.indexAt(scrollLeft) - OVERSCAN);
    const colEnd = Math.min(
      colCount - 1,
      colMetrics.indexAt(scrollLeft + viewportWidth) + OVERSCAN
    );
    return { rowStart, rowEnd, colStart, colEnd };
  }, [scrollTop, scrollLeft, viewportWidth, viewportHeight, rowMetrics, colMetrics]);
}
