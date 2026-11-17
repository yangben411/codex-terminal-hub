// Pure deadline checks shared by the browser watchdog and regression tests.
export const connectionTimeouts = Object.freeze({ handshake: 30000, silent: 60000, foreground: 20000, slow: 15000 });
export function connectionFailure({ now, startedAt, ready, pongAt, subscriptions = [] }) {
  if (!ready) return now - startedAt > connectionTimeouts.handshake ? "实时连接握手超时" : null;
  if (now - (pongAt || startedAt) > connectionTimeouts.silent) return "实时连接心跳超时";
  if (subscriptions.some((view) => view.serverActive && !view.inputReady
    && view.subscriptionStartedAt && now - view.subscriptionStartedAt > connectionTimeouts.silent)) {
    return "终端首屏同步超时";
  }
  if (subscriptions.some((view) => view.serverActive && view.inputReady
    && (view.sessionPongAt || view.sessionCheckStartedAt)
    && now - (view.sessionPongAt || view.sessionCheckStartedAt) > connectionTimeouts.silent)) {
    return "终端可操作性确认超时";
  }
  return null;
}
