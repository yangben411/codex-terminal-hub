// Tiny, independent loader: it runs without downloading xterm or the app.
(() => {
  const { t, translateStatic } = window.hubI18n;
  translateStatic(document.body);
  const panel = document.getElementById("bootStatus");
  const detail = document.getElementById("bootDetail");
  const time = document.getElementById("bootTime");
  let finished = false;
  const timer = setInterval(() => {
    if (time) time.textContent = t`已等待 ${Math.floor(performance.now() / 1000)} 秒`;
    if (detail && performance.now() > 15000) detail.textContent = t("程序仍在加载，尚未开始连接终端。请检查网络，或刷新重试。");
  }, 1000);
  window.hubBoot = {
    finish() {
      finished = true;
      clearInterval(timer);
      panel?.remove();
    },
  };
  window.addEventListener("error", event => {
    if (finished) return;
    if (detail) detail.textContent = event.target?.tagName === "SCRIPT"
      ? t("程序文件加载失败，请检查网络后刷新重试。")
      : t("程序启动发生错误，请刷新重试。");
  }, true);
  if (window.__hubAppReady) window.hubBoot.finish();
})();
