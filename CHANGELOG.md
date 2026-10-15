# Changelog

## Unreleased

以下为 `main` 分支自 0.3.0 发布后的更新，按日期倒序排列；尚未打新版本标签。

### 2026-10-14 — 修复 Claude Code 等 TUI 应用的显示刷新问题

- 修复 Claude Code (Ink 渲染器) 等 TUI 应用在输出后内容不显示的问题。内容实际存在但未刷新到屏幕，调整窗口大小可以恢复显示。
- 根本原因：某些 TUI 应用（如使用 Ink 的 Claude Code）可能缓冲输出而不立即刷新屏幕，等待某个触发事件（如 SIGWINCH）才完整重绘。
- 解决方案：在 terminal-broker 中实现"重绘助手"机制。当输出停止 3 秒后，自动发送一次微小的 resize（+1 列，然后在 50ms 后恢复），触发 SIGWINCH 让应用重绘，但不影响实际终端尺寸或用户体验。
- 保护机制：最多每 10 秒触发一次，避免过度的 SIGWINCH 信号。
- 影响：解决了 Claude Code 在窄或宽终端下都可能出现的显示问题，同时适用于其他类似的 TUI 应用。
- agy 底部内容裁切修复：修复 agy 等 TUI 将终端光标停在顶部时，键盘适配误将光标作为上移上限，导致底部输入与模型信息被裁掉；保留按实际内容定位的稀疏屏幕保护，不重启或调整 session 的 PTY 尺寸。

### 2026-10-13 — 手机系统选字备用入口

- 键盘期间可视宽度变窄时，按原列数临时缩小终端字号，输入行与模型信息保留原行距，收起键盘恢复字号；限制外部输入栏与发送按钮宽度，覆盖终端画布和整条输入栏不越界的回归。
- 移动端连接状态旁增加常驻“收起键盘”，保留未发送草稿，迟到的发送确认不再重新聚焦输入框；键盘裁切按实际内容与光标定位，避免稀疏终端只显示底部空白，保持 PTY 尺寸不变。
- 返回实时仅由明确的页面控件操作触发；落到 body/空白处的焦点和触摸事件不再销毁历史文字层。增加单字选区保留测试，并保留点击输入框返回实时的行为。
- 修复 `pointercancel` 被当作手指离开、400ms 后提前解除保护的问题：跟踪实际触摸结束和滚动手势，疑似长按保护保持到下一次无选区的新手势；在途分页同样遵守保护。
- 系统选字跳过空行与缩进，预选可见文字而非换行；增加浏览器手势交接及状态机回归，仍需真实 iPhone 验证手柄显示。
- 缓存文字长按开始时即暂停分页替换，覆盖系统尚未建立选区的时间；移除彩色文字容器的焦点属性并显式允许子文字选择。
- 新增原位“系统选字”只读文本框，可预选当前行、调整跨屏范围并复制，再切回彩色浏览；不把程序化 Range 测试视为 iPhone 手柄实测。

### 2026-10-12 — 上移补偿恢复

- 键盘补偿从未补偿的布局重新计算，不叠加上次偏移；页面平移回落时同步减小，失焦跟踪结束后清除残留。
- 从底部输入框切换到 session 内输入时继续跟踪，避免 800ms 后停止而留下旧补偿。

### 2026-10-11 — 可选缓存还原终端样式

- 手机原生可选缓存从单色文本升级为带终端样式的文字，保留 ANSI/256 色/真彩色、背景、粗体、斜体、下划线和反色，沿用终端字体与行距。
- 保留长按和跨屏圈选；按已解析单元格生成文本节点，不把终端输出当作 HTML 执行。选中期间仍不替换内容。

### 2026-10-10 — 终端外层黑边防护

- 手机缓存页默认使用原生可选文字，可直接长按并跨屏圈选全部已加载内容，不再需要先点复制；临近顶部继续分页，选中期间暂停更新以保护选区。桌面缓存渲染不变。
- 实时终端外层改为不可滚动的裁切容器，防止键盘上移后焦点追踪累积外层滚动偏移、扩大底部黑边；终端自身滚动和历史缓存不变。
- 回归测试覆盖外层滚动偏移不能累积，以及 session 底部仍对齐输入栏上方。

### 2026-10-06 — 方向面板 Esc

- 移动端方向键面板右上角新增 Esc，直接向当前 session 发送退出键，不增加面板行数。

### 2026-10-05 — 键盘期间保留 session 底部

- 移动端历史页的“复制”进入原位文字选择模式，可长按选字、复制选中或复制整屏；文字快照冻结，退出后保留历史浏览位置，不弹出对话框。
- 移动端隐藏 `0:node` 等 tmux window 栏及顶部新建 Window 按钮；释放的高度交给终端，保留菜单切换 session，桌面端不变。
- 键盘缩小可见区域时，保持终端行列不变，将完整终端画面底部对齐到按钮/输入栏上方，裁切顶部而非底部，露出 session 内的输入行。
- 终端内部 textarea 聚焦也阻止键盘触发的 PTY 重排；不改动已回退的页面容器定位方案。

### 2026-10-03 — 历史阅读位置稳定性

- 更早历史在隐藏终端中完成解析后替换显示，不再清空正在阅读的终端；以替换瞬间的阅读位置为锚，保留等待期间继续滚动的进度。
- 历史视图重排按逻辑行恢复位置，取消程序化定位的平滑动画，避免分页恢复位置时与触摸惯性竞争。
- 浏览器暂时失焦、切换应用或标签页不再强制回到实时底部；点击输入框、页面外部控件或实时按钮仍退出历史阅读。

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
