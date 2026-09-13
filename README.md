# Codex Terminal Hub

把电脑上持续运行的 tmux 会话，变成手机和桌面浏览器都能操作的私人终端。

[English](README.en.md) · [配置](docs/CONFIGURATION.md) · [架构与缓存](docs/ARCHITECTURE.md) · [常见问题](docs/TROUBLESHOOTING.md) · [安全边界](SECURITY.md)

适合一个人在不同设备间切换，查看 Codex 输出、运行命令、管理多个项目。Codex 是可选的启动入口，普通 Shell 和其他终端程序同样能用。项目不是 OpenAI、tmux 或 Tailscale 的官方产品。

> **先看安全边界：本项目没有应用层账号和密码。能够访问服务的人，就能够以服务用户的权限操作终端。默认只监听 `127.0.0.1`，远程访问使用 Tailscale Serve，并通过 tailnet 访问策略限制到你自己的设备。不要使用 Funnel、不要直接开放公网端口。**

## 能做什么

| 场景 | 当前实现 |
| --- | --- |
| 多个项目 | 自动列出同一 tmux server 的 sessions；支持总览、单窗口和最多 4 个会话的多视图 |
| 创建会话 | 在网页中选择目录、新建 session 或 tmux window；可选 Shell、Codex、Codex resume |
| 目录输入 | 实时前缀匹配文件夹；点击候选填入完整路径并继续浏览子目录；支持键盘选择 |
| 中文命名 | 输入中文标题，本地转为拼音 tmux 标识；保留中文显示标签，重名自动加后缀 |
| 记忆标签 | 可以单独改网页显示名称，不改变真实 tmux session 名和连接目标 |
| 输入 | 底部固定输入栏；发送或回车会提交文字并附带 Enter；收到输入确认后清空 |
| 输入历史 | 每个 session 保留最近 3 条输入，方向键上/下切换；未发送草稿自动保存在当前浏览器 |
| 移动端 | 可视窗口自适应、软键盘布局调整、方向控制、触摸惯性滚动；输入栏预留空间，不覆盖终端内容 |
| 历史阅读 | 上滚进入独立、冻结的缓存视图；临近顶部继续加载更早内容；离开焦点自动回实时 |
| 复制 | tmux 圈选完成后通过 OSC 52 同步剪贴板，无额外确认弹窗；另有手动纯文本复制入口 |
| 连接稳定性 | 单条 WebSocket 复用多个会话；渲染 ACK、背压和快照恢复；显示网络 RTT |
| 切换与接管 | 页面内切换 session 保留终端实例；跨浏览器通过 Reconnect 主动接管，旧连接退出 |
| 生命周期 | 页面显示连接、终端及历史加载状态；网页可关闭 session；断开网页不会杀掉 tmux |

## 安装

### 1. 准备运行环境

服务端需要 **Node.js 22.9+、npm、tmux**。建议使用 tmux 3.2 或更新版本。macOS 和 Linux 是目标平台；不支持原生 Windows 服务端。客户端使用支持 WebSocket、ResizeObserver、VisualViewport 和 Clipboard API 的现代浏览器。

macOS（已安装 Homebrew）：

```sh
brew install node@22 tmux
export PATH="$(brew --prefix node@22)/bin:$PATH"
node --version
tmux -V
```

Debian / Ubuntu 的 tmux 和本地编译依赖：

```sh
sudo apt-get update
sudo apt-get install -y tmux build-essential python3
```

Node.js 请按 [Node.js 官方安装说明](https://nodejs.org/en/download)安装满足版本要求的版本，不要假定系统源的 `nodejs` 足够新。`node-pty` 在没有对应预编译包时需要本地编译；macOS 可安装 Xcode Command Line Tools。

### 2. 下载、构建、启动

```sh
git clone https://github.com/yangben411/codex-terminal-hub.git
cd codex-terminal-hub
npm ci
npm run build
cp .env.example .env
# 编辑 .env，设置 CODEX_TERMINAL_DEFAULT_CWD 为你的项目目录绝对路径
npm run doctor
npm start
```

在服务端这台电脑打开 `http://127.0.0.1:7681/`。首次创建 session 时，没有安装 Codex 就选择 **Shell**。已有的默认 tmux sessions 会自动出现在列表中。

`.env` 不进入 Git；生成的浏览器 bundle 也不提交，首次使用以及更新源代码后都需要构建。不要只复制 `public/`：本应用需要 Node 服务和本机 tmux，不是静态网站。

### 3. 让手机和另一台电脑访问

在服务端和访问端安装并连接 Tailscale，加入允许互相访问的同一 tailnet。在**运行本项目的电脑**执行：

```sh
tailscale serve --bg http://127.0.0.1:7681
tailscale serve status
```

macOS App 版如果没有 `tailscale` 命令，可用：

```sh
"/Applications/Tailscale.app/Contents/MacOS/Tailscale" serve --bg http://127.0.0.1:7681
"/Applications/Tailscale.app/Contents/MacOS/Tailscale" serve status
```

如果提示 Serve 未启用，打开命令给出的授权链接，用 tailnet 管理账号启用，再执行命令。访问地址使用 `serve status` 返回的实际 `https://…ts.net` 域名；另一台设备上的 `127.0.0.1` 指向的是那台设备自己。

此地址只向有权限的 tailnet 设备提供服务，不是公开分享链接。原理和权限要求见 [Tailscale Serve 官方说明](https://tailscale.com/docs/features/tailscale-serve)及 [Serve 命令参考](https://tailscale.com/docs/reference/tailscale-cli/serve)。使用 HTTPS 也有助于满足浏览器剪贴板 API 的安全上下文要求。

### 4. 可选：Codex

按 [Codex CLI 官方安装与登录说明](https://developers.openai.com/codex/cli/)在服务端安装、运行 `codex` 并完成登录。安装后重新运行 `npm run doctor`，必要时在 `.env` 中指定 `CODEX_PATH`。

本项目不存储或代办 Codex 登录，不上传你的 Codex 会话记录，也不需要在项目配置中填写 OpenAI API Key。所运行的 Codex/其他 CLI 自身可能使用网络和自己的认证配置。

## 日常操作

### Session 和 window

1. 在左侧点击 session 打开终端；列表过长时可独立滚动、搜索。
2. “新建 Session”填写显示名称和目录。目录候选只出现在项目目录字段，名称字段不做目录检索。
3. 中文如 `服务器维护` 会得到类似 `fu-wu-qi-wei-hu` 的 tmux 名称，网页仍显示中文；重复名称追加 `-2`、`-3`。
4. 使用标签编辑入口修改显示名。清空显示名即可重新显示原始 tmux 名称。
5. 在会话内创建和切换 window。多视图用于同时查看不同 sessions，并可选择底部输入的目标。

关闭网页、切换设备或停止 Hub 服务，只会断开/回收终端连接，tmux 中的程序继续运行。**网页的关闭 session 操作会终止整个 session 及其中的进程，需要确认。** 在 Shell 中执行 `exit` 会关闭当前 pane；最后一个 pane/window 关闭后 session 消失。tmux 本身不是重启后的进程恢复工具。

### 手机输入与复制

- 使用底部输入栏输入文字，点击“发送”或回车提交；需要换行时使用 Shift+Enter。
- 最近输入和草稿按 session 保存在当前浏览器的 localStorage，最多 3 条历史；不跨设备同步。不要把密码、令牌当作普通输入保存在这里。
- 手机通过方向模式/方向控制发送上、下、左、右键，供命令行菜单选择使用。
- 启用 tmux 鼠标和剪贴板选项后，圈选文字完成即尝试写入浏览器剪贴板，成功或失败都会提示；浏览器仍可能因为权限或用户手势限制拒绝。
- 桌面也可使用 xterm 本地选择后复制；macOS 可按 Option 拖选。手机需要系统原生文字选择时，使用“复制”的纯文本入口。

tmux 推荐配置片段见 [examples/tmux.conf](examples/tmux.conf)。请合并到你自己的配置，不要覆盖已有绑定。`history-limit` 对新建 pane 生效，已经丢失的历史不能补回来。

### 历史、延迟与连接

上滚时，页面加载 tmux 的历史和当前屏幕快照，在第二个 xterm 中冻结显示。继续上滚接近边界才获取更早一批，**10 页是默认批次大小，不是可阅读总页数上限**。焦点离开终端或页面进入后台会回到实时视图。

缓存尽量保留终端颜色、缩进和空行，但不是完整的屏幕录像，也不是 Codex 对话数据库。历史受 tmux 保留行数限制，TUI 的反复重绘不能全部还原成聊天记录。持续输出/窗口尺寸变化时分页边界也可能漂移，详见[架构说明](docs/ARCHITECTURE.md)。

状态栏的“延迟”是每 5 秒测量一次的网络往返时间 RTT，不是输出被延迟播放的时长。现在使用渲染背压和快照追赶，不使用固定 3 秒输出缓冲。

同一浏览器内切换 session 不会立刻销毁 PTY；隐藏视图暂停推送，后台仍维护状态，默认保留 15 分钟，回来时用快照对齐。连续 15 分钟没有输入/点击等活动也会暂停可见面板订阅，操作后恢复。浏览器尤其手机系统可能提前挂起后台页面，无法保证后台持续联网。

服务面向一个人：新浏览器打开时不会无条件抢走正在使用的页面，需要点击 **Reconnect** 主动接管。服务检测可见、聚焦、活动与心跳，短暂断线提供默认 15 秒宽限状态。它不是多人协作或不同设备各自独立终端布局的系统。

## 后台运行

### macOS：登录后自动运行

先完成构建和 `.env` 设置，停止占用相同端口的前台 `npm start`，再执行：

```sh
npm run service:install
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.codex-terminal-hub.plist"
```

安装脚本只生成当前用户的 LaunchAgent，不自动重启服务；已有文件默认拒绝覆盖。需要更新安装路径时，使用 `npm run service:install -- --force`，它会备份旧 plist，然后按命令输出先 bootout 再 bootstrap。`--print` 可仅预览生成内容。

日志在 `~/Library/Logs/CodexTerminalHub/`。Node 安装路径变更后需要重新生成服务配置。服务以当前用户运行，不能阻止 macOS 休眠，也不等于开机前登录即可运行。

### Linux：systemd 用户服务

参考 [examples/codex-terminal-hub.service](examples/codex-terminal-hub.service)，把路径替换为自己的绝对路径，再放到 `~/.config/systemd/user/`：

```sh
systemctl --user daemon-reload
systemctl --user enable --now codex-terminal-hub
journalctl --user -u codex-terminal-hub -f
```

退出系统登录后是否继续运行取决于用户服务的 linger 设置；根据主机安全策略决定，不要改为 root 运行。

## 开发与验证

```sh
npm run check
npm test
npm run smoke
```

测试涵盖终端协议过滤、历史分页、输入/渲染确认、OSC 52 剪贴板、中文名称、目录候选和会话生命周期。smoke 会启动随机端口及独立 tmux socket，结束时只清理测试资源，不接管你正在使用的服务。CI 在 macOS / Ubuntu 上运行相同检查；这不替代实际 Safari、iOS 和 Android 的交互测试。

## 项目结构

```text
server.mjs                 HTTP API、会话所有权、缓存调度、WebSocket
terminal-broker.mjs        node-pty、headless xterm、快照、渲染流控
runtime-paths.mjs          二进制路径发现、可选 tmux socket
src/                       浏览器界面、协议与剪贴板模块
public/                    HTML、样式、图标；构建后生成 terminal.js/css
scripts/                   环境检查、服务安装、隔离 smoke
test/                      单元和 tmux 集成测试
docs/                      配置、架构、排障
examples/                  tmux 和 Linux 服务配置示例
```

只维护当前 xterm.js + Node PTY 实现，不再包含 ttyd、旧 iframe 页面、旧代理路由或旧固定延迟输出模块。没有旧接口兼容层。

MIT License；第三方依赖各自的许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。提交问题前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，不要附上未脱敏的终端日志。
