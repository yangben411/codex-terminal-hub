import { pinyin } from "pinyin-pro";

export function createSessionNames(value, existingNames = new Set()) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error("Session 名称请使用单行文字");
  }
  const label = value.trim();
  if (!label || label.length > 64) throw new Error("Session 名称请输入 1–64 个字符");
  const alreadyValid = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(label);
  const base = alreadyValid ? label : (pinyin(label, { toneType: "none", nonZh: "consecutive", v: true })
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|[-_]+$/g, "")
    .slice(0, 48).replace(/[-_]+$/, "") || "session");
  let name = base;
  for (let suffix = 2; existingNames.has(name); suffix += 1) {
    const ending = `-${suffix}`;
    name = base.slice(0, 48 - ending.length) + ending;
  }
  return { name, displayName: alreadyValid ? "" : label };
}
