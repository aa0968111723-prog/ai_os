/**
 * Service Worker：Web Push 跨裝置通知（手機＋電腦）。
 * 職責刻意最小——只收推播、顯示通知、點擊導頁；不攔截 fetch、不做離線快取，
 * 避免快取舊版前端造成「重新整理也修不好」的部署災難。
 */

// 新版 SW 立即接手（不等舊分頁全關）：本檔無快取狀態，跳過等待是安全的
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 非 JSON payload（理論上不會發生——伺服器只送 JSON）：退回純文字
    data = { title: "通知", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "AI Director OS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // 同 tag 互相取代（如同一發訊人的連續私訊）——手機通知列不被洗版
      tag: data.tag || undefined,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      // 已有開著的分頁→聚焦並導到目標頁；沒有→開新視窗
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // 導頁失敗（跨源等罕見情形）不阻擋——至少已聚焦到 App
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// 推送服務輪替金鑰/回收訂閱時瀏覽器發此事件：盡力就地重訂閱並回報伺服器。
// 失敗不致命——App 下次開啟時的例行同步（push.subscribe）會把訂閱補正。
self.addEventListener("pushsubscriptionchange", (event) => {
  const applicationServerKey =
    (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || undefined;
  event.waitUntil(
    (async () => {
      try {
        const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        const json = sub.toJSON();
        // tRPC 單一呼叫格式（superjson transformer：{ json: input }）；帶 cookie 走本人身分
        await fetch("/api/trpc/push.subscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } }),
        });
      } catch {
        // 靜默：下次開 App 的例行同步會修復
      }
    })(),
  );
});
