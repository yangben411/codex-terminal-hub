// tmux uses row 0 for the top of the visible screen, negative rows for
// scrollback, and inclusive capture endpoints. `before` counts from the
// bottom of the visible screen, not from row 0.
export function historyCaptureRange({ historySize, paneHeight, pageLines, before = 0 }) {
  const totalLines = historySize + paneHeight;
  const offset = Math.min(totalLines, Math.max(0, Math.floor(Number(before) || 0)));
  const lines = Math.min(pageLines, totalLines - offset);
  const end = paneHeight - 1 - offset;
  return {
    start: end - lines + 1,
    end,
    lines,
    before: offset,
    totalLines,
    nextBefore: offset + lines < totalLines ? offset + lines : null,
  };
}
