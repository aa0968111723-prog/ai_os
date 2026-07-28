/**
 * Service Worker：Web Push 跨裝置通知（手機＋電腦）。
 * 職責刻意最小——只收推播、顯示通知、點擊導頁；不攔截 fetch、不做離線快取，
 * 避免快取舊版前端造成「重新整理也修不好」的部署災難。
 */

// 新版 SW 立即接手（不等舊分頁全關）：本檔無快取狀態，跳過等待是安全的
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function safePath(url) {
  try {
    // 只允許站內路徑，避免惡意 payload 導外站
    if (typeof url !== "string" || !url) return "/";
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    const u = new URL(url, self.location.origin);
    if (u.origin === self.location.origin) return u.pathname + u.search + u.hash;
  } catch {
    /* fallthrough */
  }
  return "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 非 JSON payload（理論上不會發生——伺服器只送 JSON）：退回純文字
    data = { title: "通知", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Aios";
  const path = safePath(data.url);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // 同 tag 互相取代（如同一發訊人的連續私訊）——手機通知列不被洗版
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-96.png",
      // 部分 Android 會用
      vibrate: data.silent ? undefined : [80, 40, 80],
      data: { url: path },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // 優先重用已開著的同站分頁：聚焦並導向目標（避免多開一堆分頁）
      for (const client of windows) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin !== self.location.origin) continue;
          if ("focus" in client) await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(path);
            } catch {
              // navigate 失敗仍已聚焦
            }
          } else {
            // 無 navigate API：用 postMessage 請前端路由（若有監聽）
            try {
              client.postMessage({ type: "aios:navigate", url: path });
            } catch {
              /* ignore */
            }
          }
          return;
        } catch {
          /* 下一扇窗 */
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

// 推送服務輪替金鑰/回收訂閱時瀏覽器發此事件：盡力就地重訂閱並回報伺服器。
// 失敗不致命——App 下次開啟時的例行同步（push.sync）會把訂閱補正。
self.addEventListener("pushsubscriptionchange", (event) => {
  const applicationServerKey =
    (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || undefined;
  const oldEndpoint = (event.oldSubscription && event.oldSubscription.endpoint) || undefined;
  event.waitUntil(
    (async () => {
      try {
        const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        const json = sub.toJSON();
        // 走 push.sync（只更新不新增）：帶 oldEndpoint 讓伺服器把舊列就地改寫、保留裝置標籤；
        // 使用者移除過的裝置不會因此復活。tRPC 單一呼叫格式（superjson：{ json: input }）；帶 cookie 走本人身分
        const input = { endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
        if (oldEndpoint && oldEndpoint !== sub.endpoint) input.oldEndpoint = oldEndpoint;
        await fetch("/api/trpc/push.sync", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        });
      } catch {
        // 靜默：下次開 App 的例行同步會修復
      }
    })(),
  );
});
