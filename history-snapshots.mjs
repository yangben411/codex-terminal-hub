import { randomUUID } from "node:crypto";

// Pages are slices of one capture, never offsets into a moving tmux screen.
export class HistorySnapshots {
  constructor({ maxBytes = 64 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.entries = new Map();
  }

  create(session, content, metadata, pageLines) {
    const bytes = Buffer.byteLength(content);
    if (bytes > this.maxBytes) throw new Error("History snapshot exceeds memory budget");
    const rows = content.split("\n");
    if (rows.at(-1) === "") rows.pop();
    const snapshotId = randomUUID();
    while (this.bytes + bytes > this.maxBytes || this.entries.size >= 32) {
      const key = this.entries.keys().next().value;
      this.bytes -= this.entries.get(key).bytes;
      this.entries.delete(key);
    }
    this.entries.set(snapshotId, { session, rows, metadata, pageLines, bytes });
    this.bytes += bytes;
    return this.page(session, snapshotId, 0);
  }

  page(session, snapshotId, before) {
    const entry = this.entries.get(snapshotId);
    if (!entry || entry.session !== session) return null;
    // LRU: ongoing reads survive background cache refreshes.
    this.entries.delete(snapshotId);
    this.entries.set(snapshotId, entry);
    const { rows, metadata, pageLines } = entry;
    const offset = Math.min(rows.length, Math.max(0, Math.floor(Number(before) || 0)));
    const end = rows.length - offset;
    const start = Math.max(0, end - pageLines);
    return { ...metadata, snapshotId, content: rows.slice(start, end).map(row => row + "\n").join(""),
      lines: end - start, before: offset, nextBefore: start > 0 ? rows.length - start : null,
      hasEarlier: start > 0, totalLines: rows.length };
  }
}
