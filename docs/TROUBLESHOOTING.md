# 常见问题

Tailscale 的本地配置记录、代理/DNS 规则示例、网络测量和中继选择见 [部署与优化指南](TAILSCALE.md)。

## 先定位哪一层失败

在服务端执行 `npm run doctor`，再检查：

```sh
curl -I http://127.0.0.1:7681/
curl http://127.0.0.1:7681/api/health
tailscale serve status
```

`/api/health` 含路径和会话元信息，只用于可信环境，贴到 Issue 前必须脱敏。CLI 不在 PATH 时使用 macOS App 的完整二进制路径。

## Serve is not enabled

打开 Tailscale 命令给出的启用链接，使用有管理权限的账号完成配置，然后重试 `tailscale serve --bg http://127.0.0.1:7681`。按 Ctrl+C 产生的 `context canceled` 表示你取消了等待，不表示本地终端服务崩溃。

## 手机能开，另一台 Mac/Safari 不能开

确认两端 Tailscale 已连接，访问的域名与 `serve status` 完全一致，tailnet 策略允许客户端访问服务端。不要用 HTTPS 访问 `100.x` 地址替代域名，证书名可能不匹配。

在不能访问的那台机器上检查：

```sh
curl -Iv https://YOUR-HOST.YOUR-TAILNET.ts.net/
scutil --proxy
```

把示例域名替换成真实域名。`curl` 成功但 Safari 失败，说明需要继续检查浏览器/系统代理、DNS、TLS，而不是反复重建 tmux。命令行 curl 与 Safari 不一定走相同系统代理路径。Clash 等代理应针对你的 tailnet 域名、MagicDNS 与 Tailscale 地址设置合适的直连/DNS 例外；具体格式取决于客户端版本，不要复制他人的整份代理配置。也检查设备时间与证书错误，不要通过关闭 TLS 校验来“修复”。

页面能打开但没有终端输出时，查看浏览器网络面板中 `/api/terminal-stream` 是否得到 WebSocket 101 并持续连接。反向代理必须支持 WebSocket；不要只代理静态 HTML。

## 另一页面已连接

这是单用户接管状态，不是登录失败。新页面点击 **Reconnect** 接管。旧页面会停止发送输入；tmux 会话不会因此关闭。短暂断网可等待自动恢复，不需要重复新建会话。

## 第一次打开列表报错或找不到会话

确认服务和命令行用的是同一系统用户、同一 tmux socket。若 `.env` 配置了 `CODEX_TERMINAL_TMUX_SOCKET`，命令行也要使用 `tmux -L 名称 ls`。Hub 不能跨系统用户发现会话，也不会打开另一个主机的 tmux。

执行 `tmux ls` 没有会话属于正常情况，可在网页中新建 Shell。`npm run doctor` 只检查可执行文件存在，不代表已经启动 tmux server。

## Cannot find Codex / node-pty 启动失败

先选择 Shell 验证终端本体。在服务端确认 `command -v codex`，按需要把其绝对路径写进 `.env` 的 `CODEX_PATH`，然后重启服务。网页登录不替代 Codex CLI 自己的登录。

重新安装依赖用 `npm ci`，它会自动运行 macOS node-pty helper 执行权限修复。若需要编译则安装本地工具链。不要通过全局放开权限或使用 root 运行来绕过问题。

## 输入残留 / 已输入但未提交

输入栏的“发送”附带 Enter；直接点击终端打字则遵循所运行程序的键盘语义。输入栏在服务端确认写入后清空。超时会保留文字，先检查终端是否已经执行再重试。

当前实现过滤终端能力应答，避免 `0;276;0c` 之类内容混入输入。升级源代码后执行 `npm run build` 并刷新页面，确保 HTML 和 bundle 来自同一版本，不要继续加载旧 ttyd 页面。

## agy (Antigravity CLI) 或其他 TUI 会话显示与历史缓存说明

**1. 为什么实时屏幕只有 1 屏，查看一屏外的长结论需要上滑打开历史缓存：**
- `agy` 采用内联视口策略（`InlineStrategy`），主视图 `View()` 始终只渲染底部 1 屏高度（`pane_height - chromeHeight`），上方历史通过 `insertAbove` 推入 `tmux` 的 pane 滚回区（scrollback）；同时 `tmux attach-session` 会让网页端实时终端处于客户端 alternate screen（`\x1b[?1049h`），因此实时终端自身只承载当前 1 屏画面。
- 需要查看超出 1 屏的长结论时，在终端画面向上滚动/上滑即可冻结并打开 `tmux` 历史缓存层，或点击顶部“复制”选择“已加载缓存与当前屏幕”。

**2. 为什么不能在后台定时伪造 `cols + 1 → cols` resize：**
- 对 `agy` 发送周期性宽度抖动会触发其 150ms 去抖的 `ClearScreen`（`\x1b[2J\x1b[H`）及全量 Markdown 重排，不仅导致画面反复快速重新布局，还会因在 `deferScrollbackPush` 期间清屏而导致缓存后只剩最后 1 屏内容。
- Hub 已移除后台自动 `cols + 1 → cols` 抖动，改为在前端输出回调中实时同步 `syncTerminalBottom` 位移，并在服务端抓取历史时避开真实 resize 后的 260ms 清屏重绘窗口。

## 回翻历史少、与原画面不完全一致

历史源是 tmux 保留的当前 pane 历史。默认每批约 10 屏，临近顶部继续加载；不是无限磁盘缓存。检查 tmux 的 `history-limit`，按需增大并新建 pane。TUI 用 alternate screen 覆盖的内容可能不在 scrollback 中。

当前缓存保留颜色和缩进，但实时输出/尺寸变化时跨批次边界可能漂移。需要准确长期记录时使用应用原生日志，不能把本功能当作审计记录。

## 圈选完成但未复制

若 iPhone 长按彩色缓存仍不出现选择手柄，点缓存工具栏的“系统选字”。它在原位置切换为只读文本框并预选当前行，可长按调整范围，也可直接点“复制选中”；点“彩色浏览”返回。此模式暂停历史刷新，不会发送文字到 session。

手机上滑进入历史缓存后，直接长按文字并拖动系统选择手柄，可以跨屏选择已加载历史，再使用系统“复制”或“复制选中”。“复制已加载”复制全部已加载文字，“实时”退出缓存。移动端视图使用原生可选文字，保留终端颜色、背景和常用文字样式，复制结果仍为纯文本；字体回退、特殊装饰与终端渲染可能略有差异，桌面仍使用终端渲染。接近顶部时继续加载更早历史；圈选期间暂停加载，并丢弃可能破坏选区的在途响应。需要选择更早的内容时，先取消选择、向上滑动加载，再重新圈选。实时页面的“复制”仍直接复制整屏；要长按选择先进入缓存。

检查浏览器是否处在 HTTPS 或 localhost 安全上下文，当前页面是否可见、获得用户手势及剪贴板权限。检查 tmux `mouse on` 和 `set-clipboard external`，以及自定义复制绑定是否确实执行复制。

终端的黄色选择框是 tmux copy-mode 界面，不是浏览器原生选择句柄。同步机制在复制完成时发送一次文字；重新连接/重放快照不会再次改写剪贴板。浏览器拒绝时会显示失败提示，可使用“复制”纯文本入口和系统原生选择。

## Codex “already has an active writer”

这来自 Codex 对同一对话的写入互斥，不是 Hub 的 tmux session 命名冲突。先找出正在运行该对话的原进程/窗口，在网页中接管它，而不是同时启动另一个 resume。需要迁移时先正常退出原 Codex 再恢复；不要盲目删除锁、会话文件或强杀所有 Codex 进程。继续排查请参阅 [Codex 官方文档](https://developers.openai.com/codex/cli/)。

## 服务日志和更新

macOS LaunchAgent 日志：`~/Library/Logs/CodexTerminalHub/`。Linux 用户服务日志：`journalctl --user -u codex-terminal-hub`。

更新前保存本地修改和 `.env`，拉取指定版本，再执行 `npm ci && npm run build && npm run doctor`。重启的是 Hub，不是整个 tmux server。升级后刷新浏览器；新前端没有旧版代理/API 兼容层。
