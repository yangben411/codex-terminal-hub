import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
function load(saved, denied = false) {
  const context = { window: {}, localStorage: { getItem() { if (denied) throw new Error('denied'); return saved; } } };
  vm.runInNewContext(source, context);
  return context.window.hubI18n;
}
test('English is the default, including blocked storage and invalid preferences', () => {
  for (const i18n of [load(null), load('fr'), load(null, true)]) {
    assert.equal(i18n.language, 'en');
    assert.equal(i18n.t('发送 ↵'), 'Send ↵');
    assert.equal(i18n.t('已连接 · 可以输入并发送'), 'Connected · ready to send');
  }
});
test('Chinese is retained when explicitly selected', () => {
  const {t} = load('zh');
  assert.equal(t('发送 ↵'), '发送 ↵');
  assert.equal(t`已发送到 ${'示例网站'}`, '已发送到 示例网站');
});
test('translate only owned literal pieces, never interpolated labels or terminal text', () => {
  const {t} = load(null);
  assert.equal(t`已发送到 ${'实时复制输入'}`, 'Sent to 实时复制输入');
  assert.equal(t`原名：${'/workspace/中文/实时'}`, 'Original name: /workspace/中文/实时');
  assert.equal(t`延迟 ${25} · 滚动缓存按需加载 · ${'/workspace/输入'}`,
    'Latency 25 · Scroll for history · /workspace/输入');
  assert.equal(t('会话已结束'), 'Session ended');
});
test('known server error prefixes preserve raw error details and paths', () => {
  const {errorText} = load(null);
  assert.equal(errorText('无法创建工作目录：/workspace/实时'), 'Cannot create working directory: /workspace/实时');
  assert.equal(errorText('Unknown error in /workspace/实时'), 'Unknown error in /workspace/实时');
});
