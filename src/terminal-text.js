// Read rendered cells instead of raw terminal output: escape sequences, colors
// and cursor movement have already been interpreted by xterm.
export function terminalPlainText(terminal, { viewportOnly = true } = {}) {
  const buffer = terminal.buffer.active;
  const start = viewportOnly ? buffer.viewportY : 0;
  const end = viewportOnly ? Math.min(buffer.length, start + terminal.rows) : buffer.length;
  let text = "";
  for (let row = start; row < end; row += 1) {
    const line = buffer.getLine(row);
    if (row > start && !line?.isWrapped) text += "\n";
    // Preserve spaces at soft wraps; strip only padding at logical line ends.
    const continues = row + 1 < end && buffer.getLine(row + 1)?.isWrapped;
    text += line?.translateToString(!continues) || "";
  }
  return text;
}
