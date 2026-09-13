import { copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shellQuote } from "../runtime-paths.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const label = "com.codex-terminal-hub";
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
const logs = path.join(os.homedir(), "Library", "Logs", "CodexTerminalHub");
const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const env = {
  // Do not persist npm's injected paths or an agent's temporary PATH entries.
  PATH: process.env.CODEX_TERMINAL_SERVICE_PATH || [...new Set([
    path.dirname(process.execPath), path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
  ])].join(":"),
  LANG: "en_US.UTF-8",
};
const args = [process.execPath, `--env-file-if-exists=${path.join(root, ".env")}`, path.join(root, "server.mjs")];
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join("")}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(path.join(logs, "server.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, "error.log"))}</string>
</dict></plist>
`;
if (process.argv.includes("--print")) {
  process.stdout.write(plist);
} else {
  if (process.platform !== "darwin") throw new Error("LaunchAgent installation is macOS-only. See examples/codex-terminal-hub.service for Linux.");
  await mkdir(path.dirname(plistPath), { recursive: true });
  await mkdir(logs, { recursive: true });
  if (process.argv.includes("--force")) {
    const backup = `${plistPath}.backup-${Date.now()}`;
    await copyFile(plistPath, backup).then(() => console.log(`Previous plist saved: ${backup}`), error => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await writeFile(plistPath, plist, { flag: process.argv.includes("--force") ? "w" : "wx", mode: 0o600 });
  const target = `gui/${process.getuid()}`;
  console.log(`Installed ${plistPath}\nThis command does not restart a running service. To start:\nlaunchctl bootstrap ${target} ${shellQuote(plistPath)}\nlaunchctl kickstart ${target}/${label}\nFor an already loaded service, boot it out first and wait for it to stop:\nlaunchctl bootout ${target}/${label}`);
}
