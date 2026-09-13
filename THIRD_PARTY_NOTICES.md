# Third-party software

The project source is MIT-licensed. Dependencies retain their own copyright notices and licenses; consult their installed `LICENSE` files before redistributing bundled code.

| Direct dependency | License | Source |
| --- | --- | --- |
| `@xterm/xterm`, `@xterm/headless` | MIT | [xterm.js](https://github.com/xtermjs/xterm.js) |
| `@xterm/addon-fit`, `addon-search`, `addon-serialize`, `addon-web-links` | MIT | [xterm.js addons](https://github.com/xtermjs/xterm.js/tree/master/addons) |
| `node-pty` | MIT | [microsoft/node-pty](https://github.com/microsoft/node-pty) |
| `ws` | MIT | [websockets/ws](https://github.com/websockets/ws) |
| `pinyin-pro` | MIT | [zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro) |
| `esbuild` (build tool) | MIT | [evanw/esbuild](https://github.com/evanw/esbuild) |

Exact resolved versions and transitive dependencies are recorded in `package-lock.json`. The build keeps esbuild's default legal-comment handling; do not strip dependency notices from redistributed bundles.

tmux, Node.js, Tailscale and the optional Codex CLI are separately installed software, not bundled or relicensed by this repository. Their names identify interoperability and do not imply endorsement.
