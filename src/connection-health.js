// Pure deadline checks shared by the browser watchdog and regression tests.
export function connectionFailure({ now, startedAt, ready, pongAt, subscriptions = [] }) {
  if (!ready) return now - startedAt > 12000 ? "实时连接握手超时" : null;
  if (now - (pongAt || startedAt) > 15000) return "实时连接心跳超时";
  if (subscriptions.some((view) => view.serverActive && !view.inputReady
    && view.subscriptionStartedAt && now - view.subscriptionStartedAt > 15000)) {
    return "终端首屏同步超时";
  }
  if (subscriptions.some((view) => view.serverActive && view.inputReady
    && (view.sessionPongAt || view.sessionCheckStartedAt)
    && now - (view.sessionPongAt || view.sessionCheckStartedAt) > 15000)) {
    return "终端可操作性确认超时";
  }
  return null;
}
