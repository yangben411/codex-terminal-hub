import assert from "node:assert/strict";
import { test } from "node:test";
import headless from "@xterm/headless";
import { terminalStyledRows } from "../src/terminal-styled-text.js";

test("selectable history retains ANSI, RGB, background, inverse and text attributes", async () => {
  const term = new headless.Terminal({ cols: 50, rows: 2, allowProposedApi: true,
    theme: { red: "#ff7b86", brightRed: "#ffaaaa", foreground: "#eef3f7", background: "#050607" } });
  try {
    await new Promise(resolve => term.write("\x1b[31m红\x1b[1m粗\x1b[0;38;2;1;2;3;48;5;196;3;4m字\x1b[0;7m反\x1b[0m<script>", resolve));
    const runs = terminalStyledRows(term)[0];
    assert.equal(runs.map(r => r.text).join(""), "红粗字反<script>");
    assert.equal(runs[0].style.color, "#ff7b86");
    assert.equal(runs[1].style.color, "#ffaaaa");
    assert.equal(runs[1].style.fontWeight, "bold");
    assert.equal(runs[2].style.color, "#010203");
    assert.equal(runs[2].style.backgroundColor, "#ff0000");
    assert.equal(runs[2].style.fontStyle, "italic");
    assert.equal(runs[2].style.textDecorationLine, "underline");
    assert.equal(runs[3].style.color, "#050607");
    assert.equal(runs[3].style.backgroundColor, "#eef3f7");
  } finally { term.dispose(); }
});

test("styled history preserves blank colored cells and wide/combined characters", async () => {
  const term = new headless.Terminal({ cols: 12, rows: 3, allowProposedApi: true });
  try {
    await new Promise(resolve => term.write("中e\u0301\r\n\x1b[48;5;232m  \x1b[0m\r\n", resolve));
    const rows = terminalStyledRows(term);
    assert.equal(rows[0].map(r => r.text).join(""), "中e\u0301");
    assert.equal(rows[1][0].text, "  ");
    assert.equal(rows[1][0].style.backgroundColor, "#080808");
    assert.deepEqual(rows[2], []);
  } finally { term.dispose(); }
});
