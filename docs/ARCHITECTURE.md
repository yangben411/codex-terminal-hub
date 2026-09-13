# 架构与状态

浏览器的 xterm.js 通过一条 WebSocket 连接 Node HTTP 服务。Node 为每个已打开的 session 建立 node-pty，由 PTY 执行 `tmux attach-session`。Tailscale Serve 在前面提供 tailnet 内 HTTPS/WSS 入口；本应用不调用 Tailscale 管理 API。

## 三种不同的数据

| 数据 | 位置 | 生命周期 |
| --- | --- | --- |
| Shell/CLI 进程和 tmux 保留历史 | 服务用户的 tmux server | 网页/Hub 断开后仍在；session 被终止或主机重启则不保证保留 |
| 实时画面、渲染重放和历史快照 | Node 内存和浏览器内存 | 重连可从 tmux / headless xterm 恢复当前画面；不是磁盘存档 |
| 最近 3 条输入、未发送草稿 | 当前来源的浏览器 localStorage | 通常跨刷新保留；清除网站数据会删除，不跨域名或设备同步 |

显示标签写在 tmux session 的 `@codex_web_display_name` 选项中，因此各设备看到一致的标签，但不改变 session 实际名称。没有应用数据库，没有把整个 Codex 会话目录读入或上传的机制。

## 实时输出与背压

1. PTY 输出由服务端 headless xterm 解析并赋予序号，同时维护有限增量重放队列。
2. 浏览器按序写入 xterm，写入完成后发送渲染 ACK。
3. 未确认数据超过高水位时暂停向该订阅推送增量，避免让浏览器排队无限增长；PTY/headless 状态仍更新。
4. ACK 释放积压后，用必要的快照/增量恢复画面。重连也先用快照恢复，不要求浏览器逐帧播放断线期间每一帧。

这属于稳定当前画面的流控，不是媒体播放式的固定延迟缓冲；RTT 也不能表示最终屏幕绘制延迟。终端能力应答由服务端处理，前端过滤 DA 等协议响应，避免把 `0;276;0c` 一类应答当作用户输入。

输入框提交带 `inputId` 的文字并附带回车。服务端将输入写入 PTY 后发送 `input-ack`；这是“终端已接收”的确认，不代表命令成功执行。在 ACK 丢失但命令已执行的情况下，重试可能造成重复执行；涉及付款、删除等操作应先确认终端状态。

## 历史阅读

服务端按会话维护最近一批 tmux `capture-pane -e` 的快照，保留 ANSI 颜色和空白；抓取失败可退化为纯文本。页面进入历史时请求刷新当前批次，用独立 xterm 渲染并冻结它。实时层在后面继续接收当前状态，不把新输出追加到正在阅读的历史层。

初始批次包括当前可见屏幕，避免“第一屏消失”。每批约 `paneHeight × HISTORY_CACHE_PAGES` 行，受行数上限限制。接近历史顶部时通过 `before` 游标获取更早批次并前插，不固定为总共 10 页。缓存检查器依据新输出字节量与当前批次容量的约 80% 阈值决定是否重抓，而不是每 5 秒无条件刷新所有会话。

限制必须理解：

- 页游标是相对 tmux 当前历史/屏幕的行偏移，不是持久化行 ID。持续输出、重排或历史截断期间跨批次读取可能出现边界漂移；适合临时阅读，不是可验证的完整日志存档。
- alternate-screen TUI 反复覆盖的旧画面可能从未进入 tmux scrollback，无法凭缓存还原整段交互。
- 历史和实时使用相同字体、主题、ANSI 渲染，但终端状态、鼠标交互、重排、pane 布局不是完整录像的一对一重放。
- 更多历史占用更多浏览器内存，最终以 tmux 保留的行数为限。需要永久日志时应由被运行程序提供日志，或另行设计有容量限制的记录策略。
- 离开终端焦点、页面隐藏等事件会退出历史；操作系统提前挂起网页时不保证事件及时执行。

## 连接、布局与回收

每个浏览器窗口有一个随机 client ID，它只用于单用户所有权协调，不是身份凭证。新窗口无强制 claim 时显示占用状态；用户点击 Reconnect 后 claim `force: true`，旧浏览器 WebSocket 关闭。

应用内切换 session 时保留前端终端对象和后端 broker，停掉隐藏视图增量推送。后台继续解析输出，切回来快速用快照对齐；默认 15 分钟后回收闲置视图/PT​​Y。整个页面没有活动 15 分钟也暂停可见订阅。连接回收从不主动 kill-session。

终端尺寸按实际可视区域计算，底部输入栏预留高度。服务设置打开的 tmux windows 为 `window-size latest`，默认 attach `-d` 断开其他 tmux clients。这是为单用户跨设备接管设计的，会改变同一 session 的显示宽高；不支持多个终端同时拥有彼此独立的 tmux 布局。

## 主要接口

| 接口 | 作用 |
| --- | --- |
| `GET /api/health` | 诊断信息；包含服务路径和会话运行状态，不应公开 |
| `POST /api/client/claim` | 请求或强制接管浏览器所有权 |
| `POST /api/client/heartbeat` | 可见、聚焦和最近活动状态 |
| `GET/POST /api/sessions` | 列表 / 创建 session |
| `GET /api/directories?path=…` | 服务端目录候选 |
| `DELETE /api/sessions/:slug` | 终止 session |
| `POST /api/sessions/:slug/windows` | 新建 window |
| `POST /api/sessions/:slug/select-window` | 切换 window |
| `POST /api/sessions/:slug/display-name` | 修改显示标签 |
| `GET /api/sessions/:slug/history` | 快照；支持 `refresh=1` 和 `before=…` |
| `WS /api/terminal-stream?clientId=…` | 会话复用、订阅、输入、快照、输出、ACK、ping/pong、剪贴板 |

管理接口要求当前 `X-Terminal-Client-Id`。API 与前端一起发布，目前没有面向第三方客户端的稳定接口承诺；旧 ttyd/代理/REST 输入接口已移除。HTTP 不开放 CORS，静态内容限定在 `public/`；这些限制不构成独立的用户授权系统。
