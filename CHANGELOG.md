# Changelog

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
