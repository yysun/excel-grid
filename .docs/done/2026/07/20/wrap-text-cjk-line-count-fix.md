# Wrap-text auto-fit undercounts CJK/spaceless lines

## Summary
- Fixed a bug where enabling "Wrap text" on a cell containing Chinese (or other spaceless/CJK) text left the row too short, clipping the content off both the top and bottom (due to `.xg-cell`'s vertical centering).
- Root cause: `countWrappedLines` in `src/components/ExcelGrid.tsx` split text on whitespace to estimate wrapped line count, treating an entire space-free CJK paragraph as one unbreakable "word." The cell CSS actually renders with `word-break: break-word`, so the browser wraps such text mid-character — the JS estimate (1 line) diverged wildly from the real rendered line count (11 lines in the reported case), so the auto-fit height came out far too small.
- Fix: `countWrappedLines` now falls back to per-character measurement for any word/run wider than the available cell width, mirroring the browser's `break-word` wrapping behavior. Word-based wrapping for normal space-separated text is unchanged.

## Verification
- `npx tsc --noEmit` — no errors.
- `npx vitest run` — 193/193 tests passed (no regressions; no existing test covered this path).
- Verified the algorithm directly against the real Canvas API in a running browser context using the reported Chinese sample text at a 100px column width: old algorithm reported 1 line, new algorithm reports 11 lines, matching expected `break-word` wrapping.
- UI click-driven verification in the Browser pane was attempted but blocked by a pane-level pointer-coordinate mapping issue in this session (screenshot-space vs. viewport-space mismatch), unrelated to the code change; algorithmic verification was used instead.

## Notes
- No REQ/AP docs were created for this story; it was a small, well-localized bug fix implemented directly from a screenshot bug report.
- Follow-up (not done here): add a regression test for `countWrappedLines` with CJK/spaceless input once the function is exported or otherwise testable outside the component.
- Related prior work: `.docs/done/2026/07/20/row-height-wrap-autofit.md` (original wrap auto-fit feature, which this fixes a bug in).
