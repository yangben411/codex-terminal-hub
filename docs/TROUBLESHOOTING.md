# 常见问题

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

## 回翻历史少、与原画面不完全一致

历史源是 tmux 保留的当前 pane 历史。默认每批约 10 屏，临近顶部继续加载；不是无限磁盘缓存。检查 tmux 的 `history-limit`，按需增大并新建 pane。TUI 用 alternate screen 覆盖的内容可能不在 scrollback 中。

当前缓存保留颜色和缩进，但实时输出/尺寸变化时跨批次边界可能漂移。需要准确长期记录时使用应用原生日志，不能把本功能当作审计记录。

## 圈选完成但未复制

检查浏览器是否处在 HTTPS 或 localhost 安全上下文，当前页面是否可见、获得用户手势及剪贴板权限。检查 tmux `mouse on` 和 `set-clipboard external`，以及自定义复制绑定是否确实执行复制。

终端的黄色选择框是 tmux copy-mode 界面，不是浏览器原生选择句柄。同步机制在复制完成时发送一次文字；重新连接/重放快照不会再次改写剪贴板。浏览器拒绝时会显示失败提示，可使用“复制”纯文本入口和系统原生选择。

## Codex “already has an active writer”

这来自 Codex 对同一对话的写入互斥，不是 Hub 的 tmux session 命名冲突。先找出正在运行该对话的原进程/窗口，在网页中接管它，而不是同时启动另一个 resume。需要迁移时先正常退出原 Codex 再恢复；不要盲目删除锁、会话文件或强杀所有 Codex 进程。继续排查请参阅 [Codex 官方文档](https://developers.openai.com/codex/cli/)。

## 服务日志和更新

macOS LaunchAgent 日志：`~/Library/Logs/CodexTerminalHub/`。Linux 用户服务日志：`journalctl --user -u codex-terminal-hub`。

更新前保存本地修改和 `.env`，拉取指定版本，再执行 `npm ci && npm run build && npm run doctor`。重启的是 Hub，不是整个 tmux server。升级后刷新浏览器；新前端没有旧版代理/API 兼容层。
