/**
 * Service Worker：把 Aios 做成可安裝 App
 * - Web Push
 * - 離線殼（API 永不攔截）
 * - /assets/* cache-first（Vite hash）
 * - 導航 network-first → offline.html
 * - 新版先進 waiting，使用者確認後才接管，避免編輯中途被背景更新打斷
 */
// 版號變更會丟棄舊 shell 快取。品牌資產換版時務必一併加版號，
// 否則已安裝的 PWA 會一直沿用舊圖示（開屏圖會停在舊版）。
const CACHE_VERSION = "aios-app-v2";
const PRECACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const PRECACHE_URLS = [
  "/offline.html", "/manifest.webmanifest",
  "/icons/icon-v2-192.png", "/icons/icon-v2-512.png", "/icons/icon-v2-1024.png", "/icons/icon-v2-96.png",
  "/icons/icon-v2-192-maskable.png", "/icons/icon-v2-512-maskable.png", "/icons/icon-v2-1024-maskable.png",
  "/favicon-v2.ico", "/favicon-v2-32x32.png", "/apple-touch-icon-v2.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})));
    // 不自動 skipWaiting：有舊版正在工作時，先等使用者按「立即更新」。
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("aios-app-") && k !== PRECACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function safePath(url) {
  try {
    if (typeof url !== "string" || !url) return "/";
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    const u = new URL(url, self.location.origin);
    if (u.origin === self.location.origin) return u.pathname + u.search + u.hash;
  } catch {}
  return "/";
}

function isApi(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws") || url.pathname.startsWith("/trpc");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isApi(url)) return;
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch {
        return (await caches.match("/offline.html")) || new Response("離線", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch { return hit || Response.error(); }
    })());
    return;
  }
  // manifest 決定安裝後的圖示與開屏畫面，必須 network-first：
  // 走 cache-first 會讓已安裝的 PWA 永遠讀到舊 manifest，換了圖也不會生效。
  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith((async () => {
      const cache = await caches.open(PRECACHE);
      try {
        const res = await fetch(req, { cache: "no-store" });
        if (res.ok) await cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }
  const brand = url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/favicon") || url.pathname.startsWith("/apple-touch-icon") ||
    url.pathname === "/offline.html" || url.pathname === "/icon.svg";
  if (brand) {
    // stale-while-revalidate：先回快取，背景更新。
    // 背景更新要掛 waitUntil，否則 SW 回應後被回收，cache.put 可能沒寫進去，
    // 導致新資產永遠追不上。
    event.respondWith((async () => {
      const cache = await caches.open(PRECACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res.ok) return cache.put(req, res.clone()).then(() => res);
        return res;
      }).catch(() => null);
      if (hit) {
        event.waitUntil(net);
        return hit;
      }
      return (await net) || Response.error();
    })());
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: "通知", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Aios", {
    body: data.body || "", tag: data.tag || undefined, renotify: Boolean(data.tag),
    icon: "/icons/icon-v2-192.png", badge: "/icons/icon-v2-96.png",
    vibrate: data.silent ? undefined : [80, 40, 80],
    data: { url: safePath(data.url) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const targetUrl = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("focus" in client) await client.focus();
        if ("navigate" in client) { try { await client.navigate(path); } catch {} }
        else { try { client.postMessage({ type: "aios:navigate", url: path }); } catch {} }
        return;
      } catch {}
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  const applicationServerKey = (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || undefined;
  const oldEndpoint = (event.oldSubscription && event.oldSubscription.endpoint) || undefined;
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      const json = sub.toJSON();
      const input = { endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
      if (oldEndpoint && oldEndpoint !== sub.endpoint) input.oldEndpoint = oldEndpoint;
      await fetch("/api/trpc/push.sync", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input }) });
    } catch {}
  })());
});
