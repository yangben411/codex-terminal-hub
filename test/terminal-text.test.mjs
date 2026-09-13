import assert from "node:assert/strict";
import { test } from "node:test";
import headless from "@xterm/headless";
import { terminalPlainText } from "../src/terminal-text.js";

test("plain text copies rendered Unicode and indentation without terminal controls", async () => {
  const terminal = new headless.Terminal({ cols: 40, rows: 3, allowProposedApi: true });
  try {
    await new Promise(resolve => terminal.write("\x1b[31m  中文\x1b[0m\r\n\r\nold\r\x1b[2Knew", resolve));
    assert.equal(terminalPlainText(terminal), "  中文\n\nnew");
  } finally { terminal.dispose(); }
});

test("plain text joins soft wraps, preserves spaces, and scopes export to the viewport", async () => {
  const terminal = new headless.Terminal({ cols: 8, rows: 2, scrollback: 100, allowProposedApi: true });
  try {
    await new Promise(resolve => terminal.write("1234567 wrapped\r\nnext\r\nlast", resolve));
    assert.equal(terminalPlainText(terminal, { viewportOnly: false }), "1234567 wrapped\nnext\nlast");
    assert.equal(terminalPlainText(terminal), "next\nlast");
  } finally { terminal.dispose(); }
});
