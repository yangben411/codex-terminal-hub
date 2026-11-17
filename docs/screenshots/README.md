# Screenshot provenance / 截图说明

Captured 2026-11-14 from the local development UI. These are browser screenshots, not generated illustrations or screenshots of private sessions.

截图来自真实网页组件，但所有业务内容均为虚构数据，无需事后遮盖真实敏感信息：

- 会话：`web-demo`、`api-demo`、`docs-demo`、`agent-demo`。
- 路径：虚构的 `/workspace/...`；没有用户目录、真实项目或服务器地址。
- 输出：脚本内固定的演示文字；测试通过和延迟数值不是实际性能测量。
- 网络：临时本地 HTTP 服务、模拟 WebSocket；浏览器禁止请求该临时服务之外的地址。
- 手机：390 × 844、触摸能力模拟；不宣称是在 iPhone Safari 实机上截取。
- 未读取 `.env`、浏览器个人资料、实际会话日志或 Tailscale 配置。

All business data is synthetic. Network access is restricted to the temporary demo server. No real credentials, conversations, project paths, or device addresses are included. Images have been visually reviewed. Existing unrelated code changes were not included in the documentation upload.

## Reproduce / 重新生成

Build the UI, then run with Playwright and Chromium available:

```sh
npm run build
node scripts/screenshots.mjs
```

If Playwright or Chromium is installed elsewhere, set `PLAYWRIGHT_MODULE` to its module entry point and `CHROMIUM_EXECUTABLE_PATH` to the browser executable. The script overwrites only these four generated documentation images. Review every image before committing. The UI may differ with the checked-out source version.
