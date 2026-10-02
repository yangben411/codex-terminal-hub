# Changelog

## Unreleased

以下为 `main` 分支自 0.3.0 发布后的更新，按日期倒序排列；尚未打新版本标签。

### 2026-10-02 — 手机组合方向键、键盘避让与输入法

- 手机方向面板新增 Shift+← 按钮，直接向当前终端发送组合键，不操作底部输入框的光标或输入历史。
- 手机顶部「复制」改为直接复制当前实时或历史屏幕的文字，无需鼠标圈选或再次确认；剪贴板权限不可用时提供冻结的纯文本供长按选择。
- 手机输入聚焦时持续跟踪可视区域和输入栏实际位置；浏览器在键盘展开后继续平移页面时，自动上移页面避免输入框被遮挡，同时保持终端不重排。
- 跟踪中文输入法组合输入周期，对组合结束后紧随的确认 Enter 保留原生处理，避免确认候选或标点时误发送并锁定输入。
- 浏览器模拟回归覆盖延迟页面平移、输入法组合事件及中文标点投递；未替代真实手机输入法验证。

### 2026-10-01 — 移动端状态简化与自动创建目录

- 移动端底部状态栏隐藏 session 名称，保留连接与发送状态；桌面端仍显示目标名称。
- 新建 session 提交时自动创建不存在的工作目录（支持多级目录、中文及相对路径）；输入建议不创建目录。已有文件占用路径或创建失败时明确报错。

### 2026-09-30 — 精简底部输入栏

- 移除方向按钮右侧的目标 session 下拉框及其预留列，腾出输入空间。
- 单会话直接发送到当前 session；多视图下通过点击或聚焦终端面板选择输入目标，状态栏显示目标名称。

### 2026-09-29 — 手机发送、标点输入与软键盘稳定性

- 修复发送模块以错误的调用上下文执行浏览器计时器导致的 `Illegal invocation`；该异常会在发送前中断流程，并让后续按键被误当作发送期间输入拦截。
- 恢复不支持 `crypto.randomUUID()` 环境下的消息 ID 兼容处理。
- 点击发送时保持输入框焦点，避免软键盘收起引起按钮移动、点击丢失；输入法组合事件保留原生处理，标点原样发送。
- 在统一终端尺寸调整入口拦截键盘期间的重排，覆盖窗口事件、ResizeObserver 及延迟定时器；键盘挤压可视区域时不重设 tmux 尺寸。
- 输入框发送前退出 tmux copy-mode，避免文字被复制模式的快捷键吞掉；终端内直接按键仍保留原有行为。
- 浏览器回归验证无 randomUUID、触摸发送、标点、等待确认锁定以及键盘期间不发送 resize；隔离 smoke 验证复制模式下的输入框投递。

### 2026-09-27 — 发送锁定与重复提交防护

- 一次只处理一条输入。等待连接或发送确认期间，锁定输入框、目标 session 选择和发送按钮，阻止重复提交。
- 从提交开始最多等待 30 秒。连接超时会取消待发送任务，之后恢复连接也不会补发这条内容。
- 已发出的内容不会因缺少确认而自动重发。确认超时后保留输入，提示“可能已送达，请先检查终端”；确认超时不等于命令未执行。
- 迟到的确认不会清空新的提交；切换 session 后，仅清理与已确认内容一致的草稿。
- 新增发送状态测试，覆盖重复提交、等待连接、确认超时、迟到确认和取消后不再投递。

提交：[c41e48c](https://github.com/yangben411/codex-terminal-hub/commit/c41e48c)

### 2026-09-25 — 按 session 显示有效延迟

- 改为逐个 session 探测，服务端确认已订阅且终端通道仍可写后，才显示该 session 的往返延迟。
- 未连接、会话结束、输入未确认时不再显示旧毫秒数；超过 12 秒未收到有效回应，显示“连接无响应”。重连后重新测量。
- 延迟表示 session 通道的往返时间，不表示 Claude/Codex 的生成耗时或命令执行耗时。
- 扩充隔离 smoke 检查，验证网页连接正常但 session 尚未订阅时，不会返回 session 已连接。

提交：[363dbb8](https://github.com/yangben411/codex-terminal-hub/commit/363dbb8)

### 2026-09-24 — 最新缓存就绪后再阅读

- 上滚进入历史阅读时获取新的终端快照，加载期间显示“正在加载最新缓存，请稍候”，并暂停历史滚动操作。
- 后台已有抓取任务时，等待其完成后重新抓取；刷新失败明确报错，不再回退到旧快照冒充最新内容。
- 焦点移出 session 后自动返回实时并滚到底部；后续输出绘制完成后持续跟随底部。

提交：[f64fa3e](https://github.com/yangben411/codex-terminal-hub/commit/f64fa3e)

### 2026-09-21 — 提前加载更早历史

- 从距顶部仅 8 行才加载，调整为距顶部约两屏时预加载；加载成功后若仍靠近顶部，继续补充下一批。
- 网页不设置总页数上限，加载失败或退出阅读后停止连续加载。
- 历史来源仍是 tmux 当前保留的内容，受其 `history-limit` 限制；本更新不提供无限磁盘归档，也无法恢复已丢弃的历史。

提交：[a801c90](https://github.com/yangben411/codex-terminal-hub/commit/a801c90)

### 2026-09-20 — 回车发送事件处理

- Enter 直接调用发送逻辑，阻止事件继续冒泡，移除合成按钮点击的中间步骤。
- 保留 Shift+Enter 换行和输入法组合输入处理。

提交：[a4bcaa8](https://github.com/yangben411/codex-terminal-hub/commit/a4bcaa8)

### 2026-09-19 — 移动端输入、底栏布局与连接状态

- 软键盘弹出时保持终端内容稳定，避免高度变化触发历史重载；保留标点符号输入。
- 输入栏使用独立底部布局行，为其预留空间，避免覆盖终端内容；分别整理桌面端和移动端底栏，收紧窄屏控件间距。
- 增加当前 session 的输入状态，区分连接中、可发送、等待确认和发送未确认。
- 历史分页从用户阅读手势触发；输入框获得焦点时取消触摸惯性，退出历史后丢弃迟到的分页响应。
- 增加隔离浏览器回归脚本，覆盖键盘尺寸变化、历史请求、输入提交、标点、触摸惯性和桌面布局；需另行提供 Playwright 环境。

提交范围：[351103e…8d8c3be](https://github.com/yangben411/codex-terminal-hub/compare/9fa23e1...8d8c3be)

### 2026-09-13 — 启动环境兼容性

- 使用可移植的 tmux 字段分隔方式，并整理 macOS LaunchAgent 启动环境。

提交：[9fa23e1](https://github.com/yangben411/codex-terminal-hub/commit/9fa23e1)

## 0.3.0 — 2026-09-13

First standalone public release of the consolidated implementation.

- Native xterm.js interface with Node PTY/tmux brokers and a multiplexed WebSocket.
- Mobile layout and composer, three-entry input history, saved drafts and direction controls.
- On-demand frozen history pages, render ACK/backpressure, reconnect snapshots and RTT status.
- Explicit single-browser takeover, retained session views and idle broker cleanup.
- Directory-prefix completion, local Chinese-to-pinyin names, display labels and window/session management.
- tmux OSC 52 clipboard forwarding and browser-gesture-aware writes.
- Portable executable discovery, optional isolated tmux socket, environment checks, generated macOS LaunchAgent and Linux user-service example.
- Isolated smoke tests, macOS/Linux CI, Chinese/English guides and security documentation.
- Removed ttyd, iframe frontend, obsolete proxy/REST-input routes, old smoothing buffer and versioned duplicate app entrypoints. No compatibility layer for those endpoints.

This release does not add multi-user authentication, persistent terminal recording or guaranteed delivery latency.
