import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * `client/public/sw.js` 的快取路由回歸測試。
 *
 * 背景：品牌圖示換到 v2 之後，手機開屏畫面仍停在 v1 的舊圖（糊、且烘了米色紙面
 * 與投影）。原因是 Service Worker 把 `manifest.webmanifest` 與 `/icons/*` 都走
 * cache-first，且 `CACHE_VERSION` 沒跟著調高，已安裝的 PWA 永遠追不到新資產。
 * 以下測試把「manifest 走 network-first」「品牌資產的背景更新有掛 waitUntil」
 * 與「清單路徑真的存在」釘住。
 */

const PUBLIC_DIR = path.resolve(import.meta.dirname, "../public");
const SW_SOURCE = fs.readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf8");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(PUBLIC_DIR, "manifest.webmanifest"), "utf8"),
) as {
  icons: { src: string; sizes: string; purpose: string }[];
  shortcuts: { icons: { src: string }[] }[];
};

const ORIGIN = "https://aios.test";

type FakeResponse = { ok: boolean; body: string; clone(): FakeResponse };

function makeResponse(body: string, ok = true): FakeResponse {
  const res: FakeResponse = { ok, body, clone: () => makeResponse(body, ok) };
  return res;
}

class FakeCache {
  store = new Map<string, FakeResponse>();
  async match(req: { url: string } | string) {
    return this.store.get(typeof req === "string" ? req : req.url);
  }
  async put(req: { url: string } | string, res: FakeResponse) {
    this.store.set(typeof req === "string" ? req : req.url, res);
  }
  async add(url: string) {
    const res = await this.fetcher(url);
    if (res?.ok) this.store.set(new URL(url, ORIGIN).href, res);
  }
  fetcher: (url: string) => Promise<FakeResponse | null> = async () => null;
}

type Harness = {
  handlers: Map<string, ((event: unknown) => void)[]>;
  caches: Map<string, FakeCache>;
  scope: Record<string, unknown>;
  precacheUrls: string[];
};

/** 在假的 ServiceWorkerGlobalScope 裡載入 sw.js，回傳可驅動的 harness。 */
function loadServiceWorker(fetchImpl: (url: string) => Promise<FakeResponse>): Harness {
  const handlers = new Map<string, ((event: unknown) => void)[]>();
  const cacheStorage = new Map<string, FakeCache>();

  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: string, fn: (event: unknown) => void) {
      const list = handlers.get(type) ?? [];
      list.push(fn);
      handlers.set(type, list);
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { showNotification: async () => {}, pushManager: { subscribe: async () => ({}) } },
  };

  const caches = {
    async open(name: string) {
      let cache = cacheStorage.get(name);
      if (!cache) {
        cache = new FakeCache();
        cache.fetcher = async (url: string) => fetchImpl(new URL(url, ORIGIN).href);
        cacheStorage.set(name, cache);
      }
      return cache;
    },
    async keys() {
      return [...cacheStorage.keys()];
    },
    async delete(name: string) {
      return cacheStorage.delete(name);
    },
    async match(url: string) {
      for (const cache of cacheStorage.values()) {
        const hit = await cache.match(new URL(url, ORIGIN).href);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const sandbox = {
    self,
    caches,
    URL,
    console,
    Response: Object.assign(
      function Response(body: string) {
        return makeResponse(body);
      },
      { error: () => makeResponse("", false) },
    ),
    fetch: (req: { url: string } | string) =>
      fetchImpl(typeof req === "string" ? new URL(req, ORIGIN).href : req.url),
  };

  vm.runInNewContext(SW_SOURCE, sandbox, { filename: "sw.js" });

  const precacheUrls = (SW_SOURCE.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/)?.[1] ?? "")
    .match(/"([^"]+)"/g)!
    .map((s) => s.slice(1, -1));

  return { handlers, caches: cacheStorage, scope: sandbox, precacheUrls };
}

/** 驅動一次 fetch 事件，回傳 respondWith 的結果與 waitUntil 的背景工作。 */
async function dispatchFetch(h: Harness, urlPath: string, mode = "no-cors") {
  const request = { url: new URL(urlPath, ORIGIN).href, method: "GET", mode };
  // 用物件持有，避免 TS 因為賦值發生在 closure 內而把型別窄化成 never
  const captured: { promise: Promise<FakeResponse> | null } = { promise: null };
  const waits: Promise<unknown>[] = [];
  const event = {
    request,
    respondWith(p: Promise<FakeResponse>) {
      captured.promise = p;
    },
    waitUntil(p: Promise<unknown>) {
      waits.push(p);
    },
  };
  for (const fn of h.handlers.get("fetch") ?? []) fn(event);
  const response = captured.promise ? await captured.promise : null;
  return { response, waits, settleWaits: () => Promise.all(waits) };
}

describe("service worker 品牌資產快取", () => {
  it("precache 清單與 manifest 圖示都指向實際存在的檔案", () => {
    const h = loadServiceWorker(async () => makeResponse("net"));
    const missing = h.precacheUrls.filter((u) => !fs.existsSync(path.join(PUBLIC_DIR, u)));
    expect(missing).toEqual([]);

    const iconSrcs = [
      ...MANIFEST.icons.map((i) => i.src),
      ...MANIFEST.shortcuts.flatMap((s) => s.icons.map((i) => i.src)),
    ];
    expect(iconSrcs.filter((src) => !fs.existsSync(path.join(PUBLIC_DIR, src)))).toEqual([]);
  });

  it("manifest 宣告的圖示都被 precache（安裝後才不會缺圖）", () => {
    const h = loadServiceWorker(async () => makeResponse("net"));
    const notPrecached = MANIFEST.icons
      .map((i) => i.src)
      .filter((src) => !h.precacheUrls.includes(src));
    expect(notPrecached).toEqual([]);
  });

  it("manifest 提供 1024 圖示，高 DPI 開屏才是縮小而非放大", () => {
    const sizes = MANIFEST.icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
    expect(sizes).toContain("1024x1024");
  });

  it("manifest.webmanifest 走 network-first：有網路時必須回新版", async () => {
    const h = loadServiceWorker(async () => makeResponse("new-manifest"));
    // 先把舊 manifest 塞進 shell 快取，模擬已安裝的 PWA
    const cache = await (h.scope.caches as { open(n: string): Promise<FakeCache> }).open("aios-app-v3-shell");
    await cache.put(new URL("/manifest.webmanifest", ORIGIN).href, makeResponse("old-manifest"));

    const { response } = await dispatchFetch(h, "/manifest.webmanifest");
    expect(response?.body).toBe("new-manifest");
    // 並且新版有寫回快取
    expect((await cache.match(new URL("/manifest.webmanifest", ORIGIN).href))?.body).toBe("new-manifest");
  });

  it("manifest.webmanifest 離線時退回快取", async () => {
    const h = loadServiceWorker(async () => {
      throw new Error("offline");
    });
    const cache = await (h.scope.caches as { open(n: string): Promise<FakeCache> }).open("aios-app-v3-shell");
    await cache.put(new URL("/manifest.webmanifest", ORIGIN).href, makeResponse("cached-manifest"));

    const { response } = await dispatchFetch(h, "/manifest.webmanifest");
    expect(response?.body).toBe("cached-manifest");
  });

  it("/icons/* 先回快取，但背景更新掛在 waitUntil 上（否則新圖永遠追不上）", async () => {
    const h = loadServiceWorker(async () => makeResponse("fresh-icon"));
    const cache = await (h.scope.caches as { open(n: string): Promise<FakeCache> }).open("aios-app-v3-shell");
    const iconUrl = new URL("/icons/icon-v2-512.png", ORIGIN).href;
    await cache.put(iconUrl, makeResponse("stale-icon"));

    const { response, waits, settleWaits } = await dispatchFetch(h, "/icons/icon-v2-512.png");
    // 首次仍回快取（不阻塞畫面）
    expect(response?.body).toBe("stale-icon");
    // 關鍵：背景更新必須被 waitUntil 保活
    expect(waits.length).toBeGreaterThan(0);

    await settleWaits();
    expect((await cache.match(iconUrl))?.body).toBe("fresh-icon");
  });

  it("快取沒有時直接回網路", async () => {
    const h = loadServiceWorker(async () => makeResponse("from-network"));
    const { response } = await dispatchFetch(h, "/icons/icon-v2-192.png");
    expect(response?.body).toBe("from-network");
  });

  it("API 請求不被攔截", async () => {
    const h = loadServiceWorker(async () => makeResponse("nope"));
    for (const p of ["/api/trpc/me", "/ws", "/trpc/x"]) {
      const { response } = await dispatchFetch(h, p);
      expect(response).toBeNull();
    }
  });
});

describe("品牌資產引用", () => {
  it("已出貨的程式碼不再引用 v1 圖示路徑", () => {
    const targets = [
      "client/public/sw.js",
      "client/public/manifest.webmanifest",
      "client/public/offline.html",
      "client/index.html",
      "client/src/components/InstallAppBanner.tsx",
      "src-tauri/tauri.conf.json",
    ];
    const repoRoot = path.resolve(import.meta.dirname, "../..");
    // v1 圖示把米色紙面與投影烘進圖裡，放在 #e9e3d8 底上會出現灰色方框。
    const v1 = /\/(icons\/icon-(?:96|192|512)(?:-maskable)?\.png|apple-touch-icon\.png|favicon\.ico|favicon-(?:16x16|32x32)\.png)/;
    const offenders = targets.filter((f) => v1.test(fs.readFileSync(path.join(repoRoot, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
