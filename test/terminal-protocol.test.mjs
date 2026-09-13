import assert from "node:assert/strict";
import { test } from "node:test";
import { isBareTerminalProtocolArtifact, isTerminalProtocolReply } from "../src/terminal-protocol.js";

test("terminal protocol replies are not mistaken for user input", () => {
  assert.equal(isTerminalProtocolReply("\x1b[>0;276;0c"), true);
  assert.equal(isTerminalProtocolReply("\x1b[?1;2c"), true);
  assert.equal(isTerminalProtocolReply("\x1b[12;42R"), true);
  assert.equal(isTerminalProtocolReply("\x1b[8;34;132t"), true);
  assert.equal(isTerminalProtocolReply("\x1b[A"), false);
  assert.equal(isTerminalProtocolReply("hello"), false);
});

test("only a standalone leaked DA2 fragment is treated as a stored artifact", () => {
  assert.equal(isBareTerminalProtocolArtifact("0;276;0c"), true);
  assert.equal(isBareTerminalProtocolArtifact(" 0;276;0c 0;276;0c "), true);
  assert.equal(isBareTerminalProtocolArtifact("请检查 0;276;0c 这个字符串"), false);
});
