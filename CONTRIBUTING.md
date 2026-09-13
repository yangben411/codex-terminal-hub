# Contributing

Please discuss major architecture changes in an issue first. The project targets one operator using trusted devices. Do not silently add public exposure, multi-user promises, hidden telemetry or destructive session cleanup.

## Local checks

Use Node.js 22.9+ and tmux, then run:

```sh
npm ci
npm run check
npm test
npm run smoke
```

The smoke test uses an ephemeral port and a unique tmux socket; it must never target the user's live Hub. tmux integration tests use isolated servers and clean up only their own resources. Some unit tests skip when tmux is missing, so install tmux before treating a test run as release verification.

For frontend changes, also manually test desktop resizing, small Safari windows, mobile soft keyboards, composing Chinese with IME, input submission, session switching, history pagination, focus return and clipboard denial. Automated protocol tests do not prove those interactions work in every browser.

## Source layout

Edit `src/app.js` and the small browser helper modules, not generated `public/terminal.js`. Edit static markup/styles under `public/`. Run the build after changes; generated bundles and dependencies are ignored by Git.

Do not introduce old ttyd routes or a second frontend. Keep API and frontend changes together. Document lifecycle, performance and security tradeoffs accurately. Avoid claiming permanent history recording or guaranteed latency without an implementation that provides them.

## Privacy

Never commit `.env`, credentials, local service plists, terminal logs, personal tmux/Codex sessions or real project directory listings. Use synthetic fixtures and redact bug reports. Respect licenses and do not remove third-party notices from redistributed dependency code.

Contributions are under the project's MIT license.
