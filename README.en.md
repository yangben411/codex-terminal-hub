# Codex Terminal Hub

A private, mobile-friendly browser interface for your persistent tmux sessions. Use a phone or another computer to check a running CLI, send commands, browse recent output, and manage projects through Tailscale Serve.

[中文完整说明](README.md) · [Configuration](docs/CONFIGURATION.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)

**Single user, trusted devices only. There is no application login. Anyone who can reach this service can obtain a shell with the host user's permissions. Keep the listener on loopback and restrict access using your tailnet policy. Never expose it with Tailscale Funnel or a public port.**

## Features

- Session overview, search, single-session focus and up to four-session multi-view.
- Create sessions and windows from the browser, with live directory-prefix suggestions.
- Chinese titles are converted locally into ASCII pinyin identifiers; display labels remain editable without renaming the actual tmux session.
- A bottom composer that reserves layout space; send text plus Enter, last three inputs per session, and locally saved unsent drafts.
- Mobile viewport/soft-keyboard handling, direction controls and inertial history scrolling.
- A frozen xterm history layer with on-demand earlier pages, automatically returning to live output when focus leaves.
- tmux OSC 52 selection-to-clipboard integration, subject to browser permissions, plus an optional plain-text copy view.
- One multiplexed WebSocket, render acknowledgements, backpressure, snapshots and visible RTT.
- Explicit Reconnect takeover between browsers; session-view retention and idle cleanup without killing tmux.

The interface is currently Chinese. Codex is optional: Shell mode and other terminal programs work too. This is an independent project, not an official OpenAI, Tailscale or tmux product.

## Quick start

Install Node.js **22.9+**, npm and tmux (3.2+ recommended) on macOS or Linux. Native Windows hosting is unsupported. If `node-pty` needs compiling, install a C/C++ toolchain and Python; on macOS use Xcode Command Line Tools.

```sh
git clone https://github.com/yangben411/codex-terminal-hub.git
cd codex-terminal-hub
npm ci
npm run build
cp .env.example .env
# Edit .env: set CODEX_TERMINAL_DEFAULT_CWD to your absolute projects directory.
npm run doctor
npm start
```

Open `http://127.0.0.1:7681/` on the host. Choose **Shell** when creating a session if Codex is not installed. Existing sessions on the current user's default tmux server are listed automatically.

For private remote access, install Tailscale on both devices and connect them to an appropriately restricted tailnet. On the **host**, run:

```sh
tailscale serve --bg http://127.0.0.1:7681
tailscale serve status
```

If prompted, enable Serve using the approval URL printed by Tailscale. Open the actual HTTPS URL returned by `serve status` on your connected phone or other computer. On macOS, the app binary may be available at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` instead of on PATH. See the [official Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

Optionally install and authenticate Codex on the host using the [official Codex CLI guide](https://developers.openai.com/codex/cli/). The Hub itself does not need an OpenAI API key. Use `CODEX_PATH` if your service cannot find the executable.

## Operating model and limitations

- Closing a browser or stopping the Hub leaves tmux processes running. **Deleting a session in the UI terminates its windows and processes.** Exiting the last shell/pane also removes the session. Host restarts do not preserve running processes.
- New browsers require explicit takeover through Reconnect. Default attach mode detaches other tmux clients for the same session, and tmux window sizes follow the latest active client. This is not multi-user collaboration or independent layouts on multiple devices.
- Switching session views retains the PTY/headless state, but pauses hidden-view output delivery. Default retention and browser idle suspension are 15 minutes. Returning uses a current snapshot. Mobile operating systems can suspend background pages earlier.
- History initially contains approximately ten screenfuls **per batch**, including the visible pane screen. Earlier batches load near the top until tmux history is exhausted. This is an in-memory reading cache, not a permanent log or a complete recording of alternate-screen TUI redraws. Pagination may drift during ongoing output or resizing.
- Displayed latency is network RTT, measured every five seconds, not an artificial three-second output delay. Render backpressure favors recovering the current screen over replaying every old animation frame.
- Input ACK means data was written to the terminal, not that a command succeeded. If an ACK is lost, retrying may execute a command twice.
- Input drafts/history stay in the browser's localStorage, not on other devices. Clearing site data removes them. Avoid storing secrets in the composer.
- Clipboard writes require a secure context and browser permission/user activation. The UI reports failures instead of claiming a successful copy; use the plain-text view for native mobile text selection if needed.

Merge the relevant settings from [examples/tmux.conf](examples/tmux.conf) into your own tmux configuration. Do not overwrite existing bindings. Increased `history-limit` applies to new panes only.

## Background service

On macOS, after building and configuring `.env`, stop any foreground server on the same port:

```sh
npm run service:install
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.codex-terminal-hub.plist"
launchctl kickstart "gui/$(id -u)/com.codex-terminal-hub"
```

The installer only generates a current-user LaunchAgent. It refuses to overwrite one unless `--force` is supplied, which preserves a backup. It does not automatically restart a running service. Logs are in `~/Library/Logs/CodexTerminalHub/`. Reinstall the agent if the Node or checkout path changes. This is a login agent and does not prevent sleep.

For Linux, edit the absolute paths in [examples/codex-terminal-hub.service](examples/codex-terminal-hub.service) and install it as a systemd **user** service. Whether it runs after logout depends on the user's linger settings. Do not run the Hub as root.

## Development

```sh
npm run check
npm test
npm run smoke
```

The smoke test starts its own ephemeral HTTP port and isolated tmux server. Tests do not take over a running Hub. CI exercises macOS and Ubuntu; actual mobile/Safari interaction still needs manual verification. Browser assets are generated by the build and not tracked in Git. This cannot be deployed as a static-only site.

Only the current xterm.js + Node PTY implementation is maintained. ttyd, iframe terminals, old proxy endpoints and fixed-delay output buffering have been removed; there is no legacy compatibility layer.

MIT license. See [third-party notices](THIRD_PARTY_NOTICES.md) and [contribution guidance](CONTRIBUTING.md).
