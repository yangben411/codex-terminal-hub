import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "darwin") {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const architecture of ["darwin-arm64", "darwin-x64"]) {
    const helper = path.join(root, "node_modules", "node-pty", "prebuilds", architecture, "spawn-helper");
    try {
      const metadata = await stat(helper);
      await chmod(helper, metadata.mode | 0o100);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
