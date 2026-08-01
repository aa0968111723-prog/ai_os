import { Component, type CSSProperties, type ReactNode } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Hint, Meta } from "./ui";

/**
 * 素材儲存健康的全站警示橫幅（素材保護）。
 *
 * 為什麼需要這一條橫幅：
 * 伺服器「沒掛到持久磁碟」或「這次開機掛到另一顆卷」時，素材照樣寫得進去、頁面一切正常，
 * 直到下一次重新部署才整批消失——在那之前使用者完全沒有任何徵兆。更糟的是介面還寫著
 * 「已永久保存」，等於在鼓勵大家把手邊唯一的原始檔刪掉。這條橫幅就是把那段沉默的空窗補起來：
 * 在**還來得及自救**的時候，講清楚「現在發生什麼／對你有什麼影響／誰該做什麼」。
 *
 * 三個刻意的設計決定：
 * 1. **一般組員也看得到**（只是換成不嚇人的文案）——真正在上傳素材、手上還留著原始檔的是他們，
 *    只通知管理員等於把唯一救得回來的人排除在外。
 * 2. **不給「關閉」鈕**——這不是「稍後再看」的通知，是資料正在失去保護。
 *    修好之後後端 degraded 會自己轉回正常，橫幅就消失了。
 * 3. **查不到就安靜消失**——後端還沒有這支 API、查詢失敗、回傳格式不對，一律不顯示、不報錯。
 *    儲存監控壞掉不該讓整個站跟著壞掉（見底下的 StorageQueryBoundary 與 normalizeStatus）。
 */

/* ────────────────────────────────────────────────────────────────
 * 後端契約（server/services/storageHealth.ts + system tRPC router）
 * ──────────────────────────────────────────────────────────────── */

export type StorageDegradeReason = "volume-changed" | "not-persistent" | "unwritable";
export type StoragePersistenceMode = "declared" | "mountpoint" | "container-layer" | "unknown";

export interface StorageStatus {
  persistence: { root: string; mode: StoragePersistenceMode; persistent: boolean; note: string };
  degraded: { degraded: boolean; reason?: StorageDegradeReason; note: string; since?: string };
  lastAudit: { finishedAt: unknown; checked: number; missing: number; corrupt: number } | null;
  /** 對帳發現「資料庫有紀錄、磁碟上找不到檔」的數量 */
  missing: number;
  /** 生成成品還沒落地（等補抓佇列） */
  pending: number;
  /** 落地失敗、已放棄重試 */
  failed: number;
  lastBackupAt: unknown;
}

/** 素材備份下載端點（後端 GET，串流 tar.gz；瀏覽器直接開新分頁即可） */
export const ASSET_BACKUP_URL = "/api/admin/backup/assets.tar.gz";

/**
 * `system` router（system.storageStatus / system.acknowledgeVolumeChange）與這一批前端同時開發，
 * 合併前 `AppRouter` 型別上還沒有這一支，直接寫 `trpc.system.*` 會編不過。
 *
 * 這裡只把「我們真正會用到的那幾個回傳欄位」宣告成最小介面，再從 trpc 上取出來——
 * 型別以本檔頂端的後端契約為準。後端併進來之後這一段可以整段刪掉，
 * 改成直接呼叫 `trpc.system.storageStatus.useQuery(...)`，呼叫端不需要改。
 */
type UseQueryOpts = {
  enabled?: boolean;
  retry?: boolean | number;
  staleTime?: number;
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
};

type SystemRouterProxy = {
  storageStatus: {
    useQuery: (
      input?: undefined,
      opts?: UseQueryOpts,
    ) => { data?: unknown; error?: unknown; isLoading?: boolean; refetch?: () => void };
  };
  acknowledgeVolumeChange: {
    useMutation: (opts?: { onSuccess?: () => void }) => {
      mutate: () => void;
      isPending?: boolean;
      error?: { message?: string } | null;
    };
  };
};

/**
 * 後端這兩支還不存在時的惰性替身：回傳「永遠沒有資料」的空殼。
 * 這兩個 stub 本身不呼叫任何 hook，而「trpc 上有沒有 system」在同一份建置裡是固定的，
 * 因此不會在 render 之間改變 hook 呼叫順序。
 */
const ABSENT_SYSTEM_API: SystemRouterProxy = {
  storageStatus: { useQuery: () => ({ data: undefined, error: null, isLoading: false, refetch: () => {} }) },
  acknowledgeVolumeChange: { useMutation: () => ({ mutate: () => {}, isPending: false, error: null }) },
};

function systemApi(): SystemRouterProxy {
  return (trpc as unknown as { system?: SystemRouterProxy }).system ?? ABSENT_SYSTEM_API;
}

/* ────────────────────────────────────────────────────────────────
 * 防禦性解析：後端回傳長得不對時當成「沒有資料」，而不是讓畫面炸掉
 * ──────────────────────────────────────────────────────────────── */

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function normalizeStatus(raw: unknown): StorageStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p = (r.persistence ?? {}) as Record<string, unknown>;
  const d = (r.degraded ?? {}) as Record<string, unknown>;
  // persistence 是判斷「要不要示警」的唯一依據，缺了它就沒得判斷——當成沒資料，安靜略過
  if (typeof p.persistent !== "boolean") return null;
  const audit = r.lastAudit && typeof r.lastAudit === "object" ? (r.lastAudit as Record<string, unknown>) : null;
  return {
    persistence: {
      root: typeof p.root === "string" ? p.root : "",
      mode: (typeof p.mode === "string" ? p.mode : "unknown") as StoragePersistenceMode,
      persistent: p.persistent,
      note: typeof p.note === "string" ? p.note : "",
    },
    degraded: {
      degraded: d.degraded === true,
      reason: typeof d.reason === "string" ? (d.reason as StorageDegradeReason) : undefined,
      note: typeof d.note === "string" ? d.note : "",
      since: typeof d.since === "string" ? d.since : undefined,
    },
    lastAudit: audit
      ? {
          finishedAt: audit.finishedAt ?? null,
          checked: num(audit.checked),
          missing: num(audit.missing),
          corrupt: num(audit.corrupt),
        }
      : null,
    missing: num(r.missing),
    pending: num(r.pending),
    failed: num(r.failed),
    lastBackupAt: r.lastBackupAt ?? null,
  };
}

/** 時間欄位可能是 Date（superjson）也可能是字串（尚未加 transformer 的路徑）——兩種都收 */
export function fmtWhen(v: unknown): string {
  if (v == null || v === "") return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-TW", { hour12: false });
}

/* ────────────────────────────────────────────────────────────────
 * 共用查詢
 * ──────────────────────────────────────────────────────────────── */

export type StorageViewer = {
  /** 開發者（超管）：唯一能按「這是我刻意換的卷」的人 */
  isDeveloper: boolean;
  /** 團隊管理員或開發者：看得懂維運說明、按得到備份鈕的人 */
  isAdmin: boolean;
  /** 管理員重設密碼後的強制改密流程進行中 */
  mustChangePassword: boolean;
};

/**
 * 儲存健康狀態查詢。橫幅與「團隊管理」的儲存卡共用同一份快取，避免兩處各打一次。
 *
 * 特意設定：
 * - `enabled` 綁登入狀態：`system.storageStatus` 是 authedProcedure，未登入打了只會拿到 401。
 * - `retry: false`：後端還沒有這支 API 時，重試只是白白多打三次。
 * - 五分鐘輪詢：儲存降級是「換了卷／磁碟滿了」這種以分鐘計的事件，不需要更即時。
 */
export function useStorageStatus(): {
  status: StorageStatus | null;
  viewer: StorageViewer | null;
  refetch: () => void;
} {
  const me = trpc.auth.me.useQuery();
  const query = systemApi().storageStatus.useQuery(undefined, {
    enabled: !!me.data,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const user = me.data?.user;
  return {
    status: query.error ? null : normalizeStatus(query.data),
    viewer: me.data
      ? {
          isDeveloper: !!user?.isSuperAdmin,
          isAdmin: !!user?.isSuperAdmin || (me.data.adminTeamIds?.length ?? 0) > 0,
          mustChangePassword: !!user?.mustChangePassword,
        }
      : null,
    refetch: () => query.refetch?.(),
  };
}

/* ────────────────────────────────────────────────────────────────
 * 文案
 * ──────────────────────────────────────────────────────────────── */

export const STORAGE_MODE_LABEL: Record<StoragePersistenceMode, string> = {
  declared: "持久磁碟（已宣告）",
  mountpoint: "獨立掛載點（持久）",
  "container-layer": "容器暫存層（重新部署就清空）",
  unknown: "無法判定",
};

/** 「現在發生什麼」——一句話講完，不用術語 */
const REASON_HEADLINE: Record<StorageDegradeReason, string> = {
  "volume-changed": "伺服器這次開機掛到的是另一顆儲存磁碟，原本的素材檔不在上面。",
  "not-persistent": "素材正寫在容器的暫存層，不是持久磁碟。",
  unwritable: "伺服器現在寫不進素材資料夾。",
};

/**
 * 只在「線上正式站」把「沒掛持久磁碟」當成警訊。
 *
 * 本機開發時素材就是寫在自己電腦的 ./data 底下，本來就不會有 Volume，
 * 每次開專案都跳紅色橫幅只會讓大家學會忽略它——真的出事時就沒人看了。
 * 後端主動標記的 degraded 則不受這個判斷影響（那是確定出事，本機也要看到）。
 */
function isLiveDeployment(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return !(
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host === "" ||
    host.endsWith(".local")
  );
}

/* ────────────────────────────────────────────────────────────────
 * 橫幅
 * ──────────────────────────────────────────────────────────────── */

/** 危險色橫幅。沿用 styles.css 既有的 danger token 與 .app-update-banner 的版面比例。 */
const BANNER_WRAP: CSSProperties = {
  paddingLeft: "max(var(--app-pad-x), var(--safe-left))",
  paddingRight: "max(var(--app-pad-x), var(--safe-right))",
};

const BANNER: CSSProperties = {
  position: "relative",
  zIndex: 29,
  maxWidth: 980,
  margin: "10px auto 0",
  padding: "10px 12px",
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  border: "1px solid var(--danger)",
  borderRadius: "var(--r-12)",
  background: "color-mix(in srgb, var(--danger-soft) 78%, var(--card))",
  color: "var(--danger-ink)",
  boxShadow: "var(--e1)",
};

const BANNER_SIGNAL: CSSProperties = {
  width: 32,
  height: 32,
  flex: "none",
  display: "grid",
  placeItems: "center",
  borderRadius: 10,
  background: "var(--danger)",
  color: "#fff",
};

function StorageAlertBannerInner() {
  const { status, viewer, refetch } = useStorageStatus();
  const ack = systemApi().acknowledgeVolumeChange.useMutation({ onSuccess: () => refetch() });

  // 沒登入／查不到／後端還沒有這支 API：安靜不顯示
  if (!status || !viewer) return null;
  // 強制改密碼對話框是 modal（AppShell 把背景設成 inert）；這條橫幅掛在那層外面，
  // 一起顯示會變成「modal 背後還有可聚焦的按鈕」。改完密碼再提醒，反正它不會消失。
  if (viewer.mustChangePassword) return null;

  const degraded = status.degraded.degraded;
  const notPersistentLive = !status.persistence.persistent && isLiveDeployment();
  if (!degraded && !notPersistentLive) return null;

  const reason: StorageDegradeReason = status.degraded.reason ?? "not-persistent";

  // ── 一般組員：不需要（也無從）處理維運細節，只要知道「先別刪本機檔、去找管理員」 ──
  if (!viewer.isAdmin) {
    return (
      <div style={BANNER_WRAP}>
        <aside className="storage-alert-banner" style={BANNER} role="alert" data-fb="素材儲存警示橫幅">
          <span style={BANNER_SIGNAL} aria-hidden>
            <Icon name="TriangleAlert" size={18} />
          </span>
          <div className="storage-alert-banner__detail" style={{ minWidth: 0, flex: 1, lineHeight: 1.45 }}>
            <strong style={{ fontSize: "var(--fs-13)" }}>素材儲存目前異常</strong>
            <div style={{ fontSize: "var(--fs-12)", marginTop: 2 }}>
              建議暫時保留你本機的原始檔（先別刪、先別清相簿），並通知管理員。
              新上傳的素材在修好之前不保證留得住。
            </div>
          </div>
        </aside>
      </div>
    );
  }

  // ── 管理員／開發者：講清楚發生什麼、影響是什麼、下一步要做什麼 ──
  const canAcknowledge = viewer.isDeveloper && reason === "volume-changed";
  return (
    <div style={BANNER_WRAP}>
      <aside className="storage-alert-banner" style={BANNER} role="alert" data-fb="素材儲存警示橫幅">
        <span style={BANNER_SIGNAL} aria-hidden>
          <Icon name="TriangleAlert" size={18} />
        </span>
        <div className="storage-alert-banner__detail" style={{ minWidth: 0, flex: 1, lineHeight: 1.45 }}>
          <strong style={{ fontSize: "var(--fs-13)" }}>素材儲存沒有保護，隨時可能整批遺失</strong>
          <div style={{ fontSize: "var(--fs-12)", marginTop: 3 }}>
            <b>發生什麼：</b>
            {REASON_HEADLINE[reason]}
            {status.persistence.root ? `（素材資料夾：${status.persistence.root}）` : ""}
          </div>
          <div style={{ fontSize: "var(--fs-12)", marginTop: 2 }}>
            <b>影響：</b>新上傳與新生成的素材，可能在下一次重新部署或重啟時整批消失；
            舊素材也可能已經讀不到（目前對帳缺檔 {status.missing} 筆）。
          </div>
          <div style={{ fontSize: "var(--fs-12)", marginTop: 2 }}>
            <b>該做什麼：</b>先到「團隊管理 → 素材儲存健康」按一次「立即下載素材備份」把現有素材抓下來，
            再請部署負責人確認持久磁碟確實掛在 {status.persistence.root || "素材資料夾"} 上。
            修好之前請先告訴團隊：手邊的原始檔暫時別刪。
          </div>
          {/* 後端原文（掛載點、錯誤碼）：對維運有用，但不該擋在人話前面 */}
          {status.degraded.note && (
            <Hint as="div" layer="always" style={{ fontSize: "var(--fs-11)", marginTop: 4 }}>
              後端診斷：{status.degraded.note}
              {status.degraded.since ? `（自 ${fmtWhen(status.degraded.since)}）` : ""}
            </Hint>
          )}
        </div>
        {canAcknowledge && (
          <div style={{ flex: "none", display: "grid", gap: 4, justifyItems: "end" }}>
            <Button
              size="sm"
              disabled={ack.isPending}
              title="確認這顆新卷是你刻意換的：解除降級狀態，恢復正常寫入"
              onClick={() => ack.mutate()}
            >
              {ack.isPending ? "處理中…" : "我已了解，這是我刻意換的新卷"}
            </Button>
            {ack.error?.message && (
              <Meta style={{ fontSize: "var(--fs-11)" }}>{ack.error.message}</Meta>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * 儲存監控壞掉時，壞的只能是儲存監控本身。
 *
 * 這條橫幅掛在 App 最外層、和整個 AppShell 平行；如果它在 render 期間丟例外
 * （例如後端契約改了形狀、或 trpc 上根本沒有 system 這一支），沒有邊界的話
 * React 會把**整棵樹**卸載——使用者看到的是一片空白頁。所以一律吞掉、渲染 null。
 */
class StorageQueryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/** 全站橫幅。掛在登入後版面最上方（App.tsx）。 */
export function StorageAlertBanner() {
  return (
    <StorageQueryBoundary>
      <StorageAlertBannerInner />
    </StorageQueryBoundary>
  );
}

/** 給「團隊管理」的儲存健康卡共用同一層保護：卡片壞掉不該弄垮整個管理頁。 */
export function StorageHealthBoundary({ children }: { children: ReactNode }) {
  return <StorageQueryBoundary>{children}</StorageQueryBoundary>;
}
