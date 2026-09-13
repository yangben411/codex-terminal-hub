const csiReplyPatterns = [
  /^\x1b\[(?:\?|>)[0-9;]*c$/,
  /^\x1b\[0n$/,
  /^\x1b\[\??[0-9]+;[0-9]+R$/,
  /^\x1b\[8;[0-9]+;[0-9]+t$/,
  /^\x1b\[\??[0-9;]+;[0-4]\$y$/,
];

export function isTerminalProtocolReply(value) {
  if (typeof value !== "string" || !value) return false;
  return csiReplyPatterns.some((pattern) => pattern.test(value))
    || /^\x1bP[\s\S]*(?:\x1b\\|\x9c)$/.test(value)
    || /^\x1b\][\s\S]*(?:\x07|\x1b\\)$/.test(value);
}

export function isBareTerminalProtocolArtifact(value) {
  return typeof value === "string" && /^(?:\s*0;276;0c\s*)+$/.test(value);
}
