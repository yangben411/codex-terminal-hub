// pointercancel hands a touch to the browser; it does not mean the finger lifted.
// A possible long-press stays protected until a new, unselected gesture starts.
export class HistorySelectionGuard {
  constructor() { this.active = false; this.intent = false; }
  get blocked() { return this.active || this.intent; }
  start(x, y, now, selected = false) {
    if (this.active) return;
    this.active = true;
    this.intent = selected;
    this.swiping = false;
    this.handedOff = false;
    this.x = x; this.y = y; this.startedAt = now;
  }
  move(x, y, now, selected = false) {
    if (!this.active) return;
    if (selected || (!this.swiping && now - this.startedAt >= 350)) this.intent = true;
    if (!this.intent && Math.hypot(x - this.x, y - this.y) > 8) this.swiping = true;
  }
  cancel(selected = false) {
    if (!this.active) return;
    this.handedOff = true;
    if (selected) this.intent = true;
    // Keep active until touchend/touchcancel, even after pointer events stop.
  }
  end(now, selected = false) {
    if (!this.active) return;
    if (selected || (!this.swiping && (this.handedOff || now - this.startedAt >= 350))) this.intent = true;
    this.active = false;
  }
}

export function initialTextSelection(text, row) {
  const lines = text.split("\n");
  const first = Math.max(0, Math.min(lines.length - 1, row));
  let index = first;
  while (index < lines.length && !lines[index].trim()) index++;
  if (index === lines.length) {
    index = first;
    while (index >= 0 && !lines[index].trim()) index--;
  }
  if (index < 0) return { start: 0, end: 0, row: 0 };
  const offset = lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
  const word = /\S+/u.exec(lines[index]);
  const start = offset + word.index;
  // Select visible text rather than a blank line or the whole long terminal row.
  return { start, end: start + word[0].length, row: index };
}
