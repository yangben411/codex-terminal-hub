const pageKey = "codex-terminal-page-id";
const appKey = "codex-terminal-standalone-id";
const valid = value => /^[A-Za-z0-9_-]{16,128}$/.test(value || "");
const read = (storage, key) => { try { return storage?.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage?.setItem(key, value); } catch {} };

export function pageIdentity({ standalone, session, local, previous, createId }) {
  // Only the installed app inherits an installation identity. Ordinary tabs
  // must never read it or acquire the installed app's ownership implicitly.
  const candidates = [standalone && read(local, appKey), read(session, pageKey), previous];
  const id = candidates.find(valid) || createId();
  write(session, pageKey, id);
  if (standalone) write(local, appKey, id);
  return id;
}
