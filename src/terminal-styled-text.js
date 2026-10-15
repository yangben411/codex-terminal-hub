// Convert parsed cells, never raw ANSI/HTML, into selectable styled text runs.
const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
const defaults = ["#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
  "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec"];
const hex = n => `#${n.toString(16).padStart(6, "0")}`;

export function terminalStyledRows(terminal) {
  const theme = terminal.options.theme || {};
  const palette = index => {
    if (index < 16) return theme[names[index]] || defaults[index];
    if (theme.extendedAnsi?.[index - 16]) return theme.extendedAnsi[index - 16];
    if (index >= 232) return hex((8 + (index - 232) * 10) * 0x010101);
    const n = index - 16, cube = [0, 95, 135, 175, 215, 255];
    return hex((cube[Math.floor(n / 36)] << 16) | (cube[Math.floor(n / 6) % 6] << 8) | cube[n % 6]);
  };
  const color = (cell, foreground) => {
    if (foreground ? cell.isFgDefault() : cell.isBgDefault()) return foreground ? theme.foreground || "#ffffff" : theme.background || "#000000";
    let value = foreground ? cell.getFgColor() : cell.getBgColor();
    if (foreground ? cell.isFgRGB() : cell.isBgRGB()) return hex(value);
    if (foreground && cell.isBold() && value < 8 && terminal.options.drawBoldTextInBrightColors !== false) value += 8;
    return palette(value);
  };
  return Array.from({ length: terminal.buffer.active.length }, (_, row) => {
    const line = terminal.buffer.active.getLine(row);
    let end = terminal.cols;
    while (end > 0) {
      const cell = line?.getCell(end - 1);
      if (cell && (cell.getChars() || !cell.isBgDefault() || cell.isInverse())) break;
      end--;
    }
    const runs = [];
    for (let column = 0; column < end; column++) {
      const cell = line.getCell(column);
      if (!cell || !cell.getWidth()) continue;
      let fg = color(cell, true), bg = color(cell, false);
      if (cell.isInverse()) [fg, bg] = [bg, fg];
      const style = {
        color: fg, backgroundColor: bg,
        fontWeight: String(cell.isBold() ? terminal.options.fontWeightBold || "bold" : terminal.options.fontWeight || "normal"),
        fontStyle: cell.isItalic() ? "italic" : "normal",
        opacity: cell.isDim() ? "0.5" : "1",
        textDecorationLine: [cell.isUnderline() && "underline", cell.isStrikethrough() && "line-through", cell.isOverline() && "overline"].filter(Boolean).join(" ") || "none",
      };
      const key = JSON.stringify(style);
      const text = cell.isInvisible() ? " ".repeat(cell.getWidth()) : cell.getChars() || " ";
      if (runs.at(-1)?.key === key) runs.at(-1).text += text;
      else runs.push({ key, style, text });
    }
    return runs;
  });
}

export function renderStyledTerminal(element, terminal) {
  const fragment = element.ownerDocument.createDocumentFragment();
  terminalStyledRows(terminal).forEach((runs, row) => {
    if (row) fragment.append(element.ownerDocument.createTextNode("\n"));
    for (const run of runs) {
      const span = element.ownerDocument.createElement("span");
      span.textContent = run.text;
      Object.assign(span.style, run.style);
      fragment.append(span);
    }
  });
  element.replaceChildren(fragment);
}
