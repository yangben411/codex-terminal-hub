# 配置参考

复制 `.env.example` 为 `.env` 后编辑。`npm start`、`npm run doctor` 和生成的 LaunchAgent 会读取该文件；系统已有的环境变量优先于 `.env`。改动后重启 Hub 服务。不要提交 `.env`。

## 运行路径

| 环境变量 | 默认 | 含义 |
| --- | --- | --- |
| `CODEX_TERMINAL_HOST` | `127.0.0.1` | HTTP 监听地址；保持 loopback，由 Tailscale Serve 代理 |
| `CODEX_TERMINAL_PORT` | `7681` | HTTP 和 WebSocket 共用端口 |
| `CODEX_TERMINAL_DEFAULT_CWD` | 项目所在目录的父目录 | 新建会话的默认项目目录；不是文件访问沙箱 |
| `TMUX_PATH` | 自动查找 `tmux` | 可执行文件绝对路径 |
| `CODEX_PATH` | 自动查找 `codex` | 可选 CLI 路径；缺失时仍可用 Shell 模式 |
| `CODEX_TERMINAL_TMUX_SOCKET` | 未设置 | 设置后使用 `tmux -L 名称`；1–80 个英文字母、数字、下划线或连字符 |
| `CODEX_TERMINAL_EXCLUSIVE` | `1` | attach 使用 `-d`，断开同 session 的其他 tmux clients；`0` 只取消此行为，不提供多浏览器用户支持 |

二进制在 PATH、Node 所在目录及常见系统/Homebrew 目录中查找。服务进程的 PATH 可能不同于交互式 Shell，优先用 `.env` 明确指定必要的路径。

默认显示当前用户默认 tmux server 的会话。如需独立命名空间，可设置 `CODEX_TERMINAL_TMUX_SOCKET=terminal-hub`，命令行相应使用 `tmux -L terminal-hub ls`。这不是用户隔离，同一系统用户仍能操作其他 socket。

## 缓存与传输

时间单位均为毫秒。数值配置会被限制在下表范围内。

| 环境变量 | 默认 | 范围 / 说明 |
| --- | --- | --- |
| `CODEX_TERMINAL_HISTORY_CACHE_MS` | `5000` | 1000–60000，检查缓存是否需要重建的周期，并非每次都完整抓取 |
| `CODEX_TERMINAL_HISTORY_CACHE_LINES` | `3000` | 200–6000，每批历史的行数软上限，至少包含一个完整可见屏幕 |
| `CODEX_TERMINAL_HISTORY_CACHE_PAGES` | `10` | 3–30，以当前 pane 高度计算每批历史量，不限制向前翻页总量 |
| `CODEX_TERMINAL_HISTORY_CAPTURE_TIMEOUT_MS` | `3000` | 1000–10000，单次 tmux 历史抓取命令超时 |
| `CODEX_TERMINAL_BROKER_IDLE_MS` | `900000` | 60000–3600000，无活动订阅后保留服务端 PTY 的时长 |
| `CODEX_TERMINAL_RENDER_HIGH_WATER_BYTES` | `262144` | 32768–2097152，未确认渲染字节达到高水位时暂停增量推送 |
| `CODEX_TERMINAL_RENDER_LOW_WATER_BYTES` | `65536` | 8192–高水位，收到确认后低于此值可恢复 |

浏览器面板保留和用户闲置暂停目前固定为 15 分钟，独立于服务端 broker 配置。网络 RTT 每 5 秒更新一次，没有人为输出延迟参数，也不提供“最多 3 秒内必定送达”的保证。

## 页面在线状态

| 环境变量 | 默认 | 范围 / 说明 |
| --- | --- | --- |
| `CODEX_TERMINAL_CLIENT_FRESH_MS` | `6000` | 3000–30000，心跳保持新鲜的时间 |
| `CODEX_TERMINAL_CLIENT_GRACE_MS` | `15000` | 心跳新鲜期–120000，临时断开宽限状态 |
| `CODEX_TERMINAL_CLIENT_ACTIVITY_MS` | `30000` | 5000–300000，用于“正在使用”的最近活动判断 |

这些值影响状态显示和恢复体验，不是身份认证或密码。现有所有权不会因为心跳过期自动授权另一个浏览器；通过 Reconnect 主动接管。
