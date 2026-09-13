// Start the write in the user's release gesture. Safari can then accept the
// text asynchronously from tmux without a second click or a confirmation UI.
export class GestureClipboard {
  constructor({ clipboard = globalThis.navigator?.clipboard, Item = globalThis.ClipboardItem, timeoutMs = 8000 } = {}) {
    this.clipboard = clipboard;
    this.Item = Item;
    this.timeoutMs = timeoutMs;
    this.pending = null;
  }

  begin(session) {
    this.cancel();
    if (!this.clipboard?.write || !this.Item) return;
    let provide, reject;
    const payload = new Promise((resolve, fail) => { provide = resolve; reject = fail; });
    // The browser may reject the write before ever consuming its payload.
    payload.catch(() => {});
    const pending = { session, provide, reject, timer: null, result: null };
    this.pending = pending;
    try {
      pending.result = Promise.resolve(this.clipboard.write([
        new this.Item({ "text/plain": payload }),
      ])).then(() => true, () => false);
      pending.timer = setTimeout(() => this.cancel(session), this.timeoutMs);
    } catch {
      this.cancel();
    }
  }

  cancel(session) {
    const pending = this.pending;
    if (!pending || (session !== undefined && pending.session !== session)) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(new Error("Selection copy cancelled"));
  }

  async write(session, text) {
    const pending = this.pending;
    if (pending?.session === session) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.provide(new Blob([text], { type: "text/plain" }));
      return pending.result;
    }
    if (pending) return false;
    try {
      if (!this.clipboard?.writeText) return false;
      await this.clipboard.writeText(text);
      return true;
    } catch { return false; }
  }
}
