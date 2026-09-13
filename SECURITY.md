# Security policy / 安全边界

This application is a **single-user remote shell**, not a multi-tenant terminal hosting service. It has not undergone an independent security audit.

- There is **no built-in login, password, MFA or per-user authorization**. A browser client ID coordinates ownership; it is not authentication. Anyone who can reach the claim endpoint can request control.
- Bind to `127.0.0.1` and use Tailscale Serve with restrictive tailnet grants/ACLs. Do not use Funnel, expose a public port, or publish this behind an unauthenticated public reverse proxy. Tailnet membership alone is not a substitute for checking who can reach the host.
- Run as a normal dedicated or personal user, never root. Terminal commands, directory suggestions and session creation have that user's filesystem and process access. The default working directory is not a sandbox.
- The health endpoint includes local paths and process/session metadata. Keep diagnostic responses and logs private.
- Clipboard integration allows terminal output to request a clipboard write during a recent interaction. Only run trusted terminal programs, and inspect clipboard content before pasting sensitive commands elsewhere.
- Composer history and drafts are stored in browser localStorage. Avoid entering passwords, access tokens or other secrets there; clear site data on shared devices. The underlying CLI manages its own credentials separately.
- HTTPS protects the connection, not an already compromised browser or trusted host. Tailscale/OS access policies, patching and backups remain the operator's responsibility.
- Closing a session terminates processes and can lose unsaved work. Input acknowledgement is not exactly-once command execution.

本项目不包含个人 `.env`、Tailscale 密钥、tailnet 配置、终端日志或 Codex 会话记录。发布问题、截图和调试信息前也请脱敏。

## Reporting

Please do not post exploitable details, real credentials or private terminal captures in a public issue. If GitHub shows **Security → Report a vulnerability** for this repository, use its private reporting channel. Otherwise open an issue asking for a private contact without including exploit details, and wait for a private channel. Only the current main/released implementation is maintained; old endpoints are intentionally unsupported.
