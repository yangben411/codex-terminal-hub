// Translate application-owned literals only. Never translate terminal output,
// session names, paths, drafts or other interpolated user data.
(() => {
  const key = "terminal-hub-language";
  let language = "en";
  try { if (localStorage.getItem(key) === "zh") language = "zh"; } catch {}
  const pairs = `
响应较慢|Slow response
响应较慢 · 保留连接，等待恢复|Slow response · keeping connection while waiting
无法创建工作目录：|Cannot create working directory:\x20
工作目录路径已被文件占用，请选择其他路径|A file already occupies this directory path. Choose another path.
Codex CLI 未安装或不在 PATH 中。请先安装，或选择只打开 Shell。|Codex CLI is not installed or not on PATH. Install it or choose Shell only.
终端正在其他交互模式中，请退出后再发送|The terminal is in another interactive mode. Exit it before sending.
显示名称请使用 64 个字符以内的单行文字|Use a single-line label of at most 64 characters.
最新历史缓存暂时无法建立，请稍后重试|Latest history is temporarily unavailable. Retry shortly.
⌨ 输入|⌨ Input
模式 ⇥|Mode ⇥
无法保存语言设置，请允许浏览器本地存储|Cannot save language. Allow browser local storage and try again.
终端未连接|Terminal disconnected
正在加载终端程序|Loading terminal app
先加载程序，再确认本页连接。后台任务继续运行。|Loading the app, then verifying this page. Background tasks keep running.
正在准备…|Preparing…
刷新重试|Refresh to retry
此页面需要启用 JavaScript 才能连接终端。|Enable JavaScript to connect to the terminal.
程序仍在加载，尚未开始连接终端。请检查网络，或刷新重试。|Still loading the app. Check your network or refresh to retry.
程序文件加载失败，请检查网络后刷新重试。|App download failed. Check your network and refresh.
程序启动发生错误，请刷新重试。|App startup failed. Refresh to retry.
关闭会话列表|Close sessions
返回总览|Back to overview
服务连接状态|Server connection status
搜索会话|Search sessions
＋ 新建 Session|＋ New session
Session 列表滚动条|Session list scrollbar
↻ 刷新状态|↻ Refresh
尚未刷新|Not refreshed yet
确认连接|Verify connection
确认本页|Verify page
实时通道|Transport
打开会话|Open session
显示首屏|First frame
可输入|Ready
打开会话列表|Open sessions
全部 tmux 工作区|All tmux workspaces
手机缓存可直接长按选字；实时页复制整屏；桌面打开纯文本|Long-press cached text on mobile; copy the live screen; open plain text on desktop
在新标签页打开|Open in a new tab
你的 Codex 控制台|Your Codex console
每个项目独立运行，断开网页也不会中止。选择会话进入，或勾选最多四个会话同时查看。|Projects keep running when you disconnect. Open a session or select up to four to view together.
以多窗打开所选|Open selected views
未选择会话|No sessions selected
还没有 tmux session|No tmux sessions yet
新建一个 session，选择工作目录和启动方式即可。|Create a session with a working directory and startup command.
新建第一个 Session|Create your first session
终端输入|Terminal input
收起输入面板|Hide input panel
收起手机键盘|Dismiss keyboard
收起键盘⌄|Keyboard⌄
收起|Hide
agy 模式轮换（Shift+Tab）；当前模式以终端提示为准|Cycle agy modes (Shift+Tab); check the terminal for the current mode
移动端方向键|Direction controls
Shift 加左方向键|Shift + Left
发送 Shift+← 到当前终端|Send Shift+Left to the terminal
Esc 退出键|Escape key
发送 Esc 到当前终端|Send Esc to the terminal
切换 agy 模式，Shift 加 Tab|Cycle agy mode with Shift+Tab
轮换 Plan、工作等模式；以终端提示为准|Cycle Plan and working modes; check the terminal for the active mode
输入会自动保存；↑↓ 切换最近 3 条输入|Draft saved; ↑↓ recalls 3 recent inputs
发送并回车|Send and press Enter
正在检查连接状态|Checking connection
正在判断当前终端页面是否仍在展示和使用。|Checking whether another terminal page is visible and in use.
重新连接并接管|Reconnect and take over
新建 tmux Session|New tmux session
Session 名称|Session name
例如：服务器维护、公众号写作|e.g. Server maintenance, Writing
支持中文。中文保留为显示名，后台自动转为拼音标识；重名时自动加数字。|Chinese names are kept as labels and converted to pinyin IDs. Duplicate IDs receive a number.
工作目录|Working directory
目录不存在时，点击创建会自动新建；相对路径以默认工作目录为起点。|Missing directories are created on submission. Relative paths start from the default workspace.
/Users/…/项目目录|/path/to/project
匹配的文件夹|Matching folders
输入文件夹名称开头可筛选，点选后继续浏览子目录。|Type a folder prefix to filter; select a folder to browse its children.
第一个 Window 名称|First window name
启动方式|Startup
启动新的 Codex|Start a new Codex session
选择并恢复 Codex 对话|Choose and resume a Codex conversation
只打开 Shell|Shell only
创建并打开|Create and open
新建 Window|New window
Window 名称|Window name
创建 Window|Create window
修改显示名称|Edit display label
例如：公众号写作、服务器维护|e.g. Writing, Server maintenance
只修改网页标签，支持中文。清空后恢复原名；手机和电脑共用此备注。|Changes only the web label. Clear it to restore the original name. Shared across devices.
纯文本复制|Copy plain text
关闭纯文本面板|Close plain-text panel
复制范围|Copy range
当前看到的一屏|Visible screen
当前终端已加载的内容|All loaded terminal content
可选择复制的终端纯文本|Selectable terminal text
全选文字|Select all
复制全部|Copy all
发送 ↵|Send ↵
等待连接…|Connecting…
等待确认…|Confirming…
发送确认超时，已停止等待，不会自动重发；内容可能已送达，请先检查终端|Confirmation timed out. Not retrying: input may have arrived. Check the terminal first.
连接超时，本次发送已取消，不会在重连后补发；输入已保留|Connection timed out. Send cancelled, draft kept. It will not be resent after reconnecting.
当前终端|Current terminal
暂无活动|No activity
刚刚活跃|Active just now
 分钟前| min ago
 小时前| hr ago
 天前| days ago
连接未就绪 · 点击重新连接后才能发送|Not ready · reconnect before sending
发送已停止 · 输入已保留，请先检查终端|Send stopped · draft kept; check terminal
等待连接 · 输入栏已锁定，超时后取消|Connecting · input locked until ready or timeout
等待终端确认 · 输入栏已锁定，请勿重复发送|Awaiting confirmation · do not resend
session 已断开 · 等待恢复连接|Session disconnected · reconnecting
连接无响应 · 等待重新确认|No response · checking connection
已连接 · 可以输入并发送|Connected · ready to send
正在连接终端 · 发送内容会暂存|Connecting · input will be held temporarily
终端未连接 · 输入会暂存，连接后发送|Disconnected · input waits for connection
 运行中| running
网页已连接|Web connected
后台待命|Idle in background
请求失败 (|Request failed (
等待连接|Waiting for connection
断线保护 |Disconnect grace:\x20
 秒| s
原页面已离线|Previous page is offline
另一页面正在使用|Another page is in use
另一页面正在展示|Another page is visible
另一页面在后台|Another page is in the background
另一页面已连接|Another page is connected
终端等待连接|Terminal waiting for connection
原页面可能只是短暂断网，服务仍在保护窗口内。需要切换到这里时，请手动重新连接。|The previous page may be briefly offline. To take over here, click Reconnect.
tmux 和 Codex 仍在后台运行。点击重新连接后，本页面会成为唯一活动页面。|Background tasks are still running. Reconnect to make this the only active page.
确认本页连接资格|Verify this page
建立实时通道|Connect transport
打开当前会话|Open session
加载并显示首屏|Render first frame
已连接，可以输入|Connected and ready
正在处理，请稍候；后台任务继续运行。|Please wait. Background tasks keep running.
等待选择|Choose a session
本步 |This step:\x20
正在将控制权交给本页。|Transferring control to this page.
只有本页获准后才开始连接终端。|The terminal connects after this page is authorized.
控制连接已建立|Control connection established
本页已获准，正在连接服务端。历史缓存稍后加载。|Page authorized. Connecting; history loads afterwards.
终端数据错误：|Terminal data error:\x20
通道已断开（|Transport disconnected (
），正在自动重试；不会重发输入。|). Reconnecting without resending input.
，正在重新连接|; reconnecting
，正在更换连接。|; replacing the connection.
确认连接中|Verifying connection
已断开|Disconnected
会话已结束|Session ended
连接错误|Connection error
未连接|Not connected
输入未确认|Input unconfirmed
连接无响应|No response
当前会话已确认可操作，历史在后台按需加载。|Session ready. History loads in the background on demand.
实时通道已建立；请选择要打开的 session，或新建一个。|Connected. Choose a session or create one.
已发送到 |Sent to\x20
终端连接错误|Terminal connection error
首屏已收到，正在渲染并确认输入通道。|First frame received. Rendering and verifying input.
同步缓存|Syncing snapshot
正在稳流|Buffering
tmux 会话已结束；终端连接已关闭|tmux session ended; terminal connection closed
tmux session 已结束，正在返回总览|tmux session ended; returning to overview
加载更早内容…|Loading earlier content…
顶部继续加载|Scroll up for more
已到最早|Start of history
正在冻结当前屏幕…|Freezing current screen…
缓存 · 冻结 |History · frozen\x20
回实时|Go live
缓存历史 · 距实时 |History · behind by\x20
 行| lines
缓存已就绪|History ready
缓存建立中|Preparing history
延迟 |Latency\x20
滚动缓存按需加载|Scroll for history
一条连接|One connection
 个 tmux sessions| tmux sessions
最新缓存尚未就绪，请稍后重试|Latest history is not ready. Please retry shortly.
历史缓存加载失败：|History failed to load:\x20
历史缓存仍在建立，请稍后再试|History is still being prepared. Please retry shortly.
原名：|Original name:\x20
打开纯文本，选择并复制|Open plain text to select and copy
查找当前缓存|Search cached text
结束这个 tmux session|End this tmux session
正在加载最新缓存，请稍候…|Loading latest history…
连接中|Connecting
终端正在重连，请稍后重试|Terminal reconnecting. Please retry shortly.
查找当前终端缓存中的文字：|Find text in the terminal cache:
正在打开 |Opening\x20
，只同步当前屏幕。|; syncing only the current screen.
修改 |Edit\x20
 的显示名称| display label
没有匹配的会话|No matching sessions
加入多窗|Add to multi-view
打开终端|Open terminal
多窗模式 · |Multi-view ·\x20
多窗终端|Multiple terminals
更新于 |Updated\x20
历史屏幕文字选择|Select history text
复制选中|Copy selection
复制已加载|Copy loaded
复制整屏|Copy screen
系统选字|Native selection
返回历史|Back to history
长按下方文字，拖动选择手柄，使用系统“复制”或“复制选中”。|Long-press text, drag selection handles, then choose Copy.
可长按选择的历史文字|Long-press to select history text
系统文字选择|Native text selection
请先长按并选中要复制的文字。|Long-press to select text first.
已复制到剪贴板。|Copied to clipboard.
浏览器未允许直接复制，请长按文字并使用系统菜单中的“复制”。|Clipboard access denied. Long-press and choose Copy from the system menu.
彩色浏览|Styled view
已切到系统选字，可长按调整范围，或点“复制选中”。内容不会刷新。|Native selection enabled. Long-press to select, then copy. Content stays frozen.
直接长按选字，可拖动手柄跨屏选择；选中期间暂停加载更早历史。|Long-press to select across screens. Earlier history pauses while selecting.
长按文字选择并复制，也可以一键复制全部。|Long-press to select and copy, or copy all.
请先打开一个 session|Open a session first
缓存正在加载，请稍后复制|History is loading. Copy when ready.
历史缓存|History cache
实时屏幕|Live screen
的文字副本，打开后不再刷新。| text snapshot; no longer updated while open.
所选文字已复制到当前设备|Selection copied to this device
浏览器未允许自动复制，剪贴板未更新|Automatic copy denied; clipboard unchanged
当前屏幕没有可复制的文字|No text to copy on this screen
当前屏幕文字已复制|Screen text copied
浏览器未允许直接复制，请长按下方文字选择并复制。|Clipboard access denied. Long-press below to select and copy.
已全选，可使用系统菜单复制。|All text selected. Use the system menu to copy.
已复制到当前设备的剪贴板。|Copied to this device's clipboard.
浏览器未允许一键复制。文字已全选，请长按并选择系统菜单中的复制。|Copy denied. Text selected; long-press and use the system Copy menu.
已选择 |Selected\x20
 个（最多 4 个）| (up to 4)
正在读取文件夹…|Loading folders…
前 80 项，请继续输入缩小范围|First 80 items; keep typing to narrow results
 个文件夹| folders
没有匹配的子文件夹；已有路径可直接用于创建。|No matching subfolders. You can use the entered path to create a session.
无法列出目录：|Cannot list directory:\x20
显示名称已保存|Display label saved
已恢复显示原名|Original name restored
将在 |Create a window in\x20
 中创建新的 tmux window。|.
确定结束 tmux session “|End tmux session “
”（原名：|” (original name:\x20
）吗？其中运行的程序会一并终止。|)? All programs running in it will be terminated.
 已结束| ended
请等待终端可操作且当前发送完成后，再切换模式|Wait until the terminal is ready and the current send completes before switching modes
已发送 Shift+Tab，当前模式以终端提示为准|Shift+Tab sent; check the terminal for the active mode
终端正在重连，未发送模式切换|Reconnecting; mode switch not sent
终端正在重连|Terminal reconnecting
多窗最多同时打开 4 个 session|Multi-view supports up to 4 sessions
 已创建| created
已在 |Created a window in\x20
 中创建 Window|
正在恢复|Recovering
闲置暂停 · 操作即恢复|Idle · interact to resume
实时连接握手超时|Transport handshake timed out
实时连接心跳超时|Transport heartbeat timed out
终端首屏同步超时|First-frame sync timed out
终端可操作性确认超时|Session readiness check timed out
已等待 |Waited\x20
总览|Overview
多窗|Multi-view
方向|Keys
模式|Mode
向上|Up
向下|Down
向左|Left
向右|Right
确认|Confirm
取消|Cancel
保存|Save
备注名|Label
复制|Copy
查找|Find
关闭|Close
实时|Live
输入|Input
`;
  const dictionary = Object.fromEntries(pairs.trim().split("\n").map(line => {
    const split = line.indexOf("|");
    return [line.slice(0, split), line.slice(split + 1)];
  }));
  const pattern = new RegExp(Object.keys(dictionary).sort((a, b) => b.length - a.length)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const literal = value => language === "zh" ? value : value.replace(pattern, match => dictionary[match]);
  const reverse = Object.fromEntries(Object.entries(dictionary).filter(([, value]) => value).map(([zh, en]) => [en, zh]));
  const staticText = value => language === "zh" && Object.hasOwn(reverse, value.trim())
    ? value.replace(value.trim(), reverse[value.trim()]) : value;
  function t(value, ...args) {
    if (Array.isArray(value)) return value.map((part, i) => literal(part) + (i < args.length ? args[i] : "")).join("");
    return literal(value);
  }
  function translateStatic(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement?.closest("script, style")) node.textContent = staticText(node.textContent);
    }
    for (const element of root.querySelectorAll("[title], [placeholder], [aria-label]")) {
      for (const attr of ["title", "placeholder", "aria-label"]) {
        if (element.hasAttribute(attr)) element.setAttribute(attr, staticText(element.getAttribute(attr)));
      }
    }
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }
  function errorText(value) {
    if (typeof value !== "string" || language === "zh") return value;
    if (Object.hasOwn(dictionary, value)) return dictionary[value];
    const prefix = "无法创建工作目录：";
    return value.startsWith(prefix) ? dictionary[prefix] + value.slice(prefix.length) : value;
  }
  window.hubI18n = { t, language, translateStatic, key, errorText };
})();
