import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FirstRunGuide } from "../components/FirstRunGuide";

/** 新手導覽「略過／看過」記憶鍵：一旦略過或建過範例就記住，之後不再自動彈出 */
const FIRST_RUN_KEY = "aios.firstRunDismissed";

function relTime(d: Date | string): string {
  const t = new Date(d).getTime();
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

/** 首頁作業台：繼續你的專案＋快速開始（設計規格 F2 簡化版） */
export function Launchpad({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(); // 已由外框載入，這裡直接吃快取
  const projects = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  // 內容類型與發布平台改由每組自訂選項供給（組長可在「選項」頁增修）。
  // includeInactive：下拉只列 active，但專案卡反查 label 要含停用的（否則舊專案的類型被停用後會顯示成亂數 value）
  const options = trpc.options.byGroup.useQuery({ groupId, includeInactive: true }, { enabled: !!groupId });
  const kindOptions = (options.data ?? []).filter((o) => o.type === "kind" && o.active);
  const platformOptions = (options.data ?? []).filter((o) => o.type === "platform" && o.active);
  const kindLabelOf = (value: string) => (options.data ?? []).find((o) => o.type === "kind" && o.value === value)?.label ?? value;
  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      utils.projects.list.invalidate();
      navigate(`/p/${project.id}`);
    },
  });

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  // 新手導覽：只在「這個組還沒有任何專案」且使用者沒略過（localStorage）時顯示
  const [firstRunDismissed, setFirstRunDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FIRST_RUN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const dismissFirstRun = () => {
    try {
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
      /* localStorage 不可用（隱私模式）時只在本次 session 記住 */
    }
    setFirstRunDismissed(true);
  };
  // 有 ≥1 個專案本身就代表「不是新手」——即使沒按過略過也不顯示導覽
  const hasNoProjects = projects.data !== undefined && projects.data.length === 0;
  const showFirstRun = !!groupId && hasNoProjects && !firstRunDismissed;
  // 選項載入後補上預設選擇（或目前選到的已被移除時，退回第一個）；避免 select 值對不到 option 顯示空白
  useEffect(() => {
    if (kindOptions.length && !kindOptions.some((o) => o.value === kind)) setKind(kindOptions[0].value);
  }, [kindOptions, kind]);
  useEffect(() => {
    if (platformOptions.length && !platformOptions.some((o) => o.value === platform)) setPlatform(platformOptions[0].value);
  }, [platformOptions, platform]);

  const activeGroup = me.data?.groups.find((g) => g.groupId === groupId);
  const pickedPlatform = platformOptions.find((p) => p.value === platform);

  return (
    <div>
      <h1>
        今天想<span className="accent">創作</span>什麼？
      </h1>
      <p className="sub">接續這個組的專案，或開一個新的。</p>

      {showFirstRun && <FirstRunGuide groupId={groupId} onDismiss={dismissFirstRun} />}

      <div className="cols">
        <section>
          <h2>{activeGroup ? `${activeGroup.groupName}的專案` : "專案"}</h2>
          {projects.error && (
            <p className="error">
              專案清單暫時載入不了——
              <button style={{ padding: "2px 12px", marginLeft: 4 }} onClick={() => projects.refetch()}>再試一次</button>
            </p>
          )}
          {projects.data?.length === 0 && <p className="hint">還沒有專案——右邊建立第一個吧 🙌</p>}
          <div className="grid">
            {projects.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`sk-${i}`} className="card proj-card skeleton" style={{ height: 92 }} aria-hidden />
              ))}
            {projects.data?.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="card proj-card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                <h3>{p.title}</h3>
                <div className="meta">
                  <span className="chip">{kindLabelOf(p.kind)}</span>
                  <span className="chip">{p.format}</span>
                  <span className="hint" style={{ fontSize: 11 }}>更新於 {relTime(p.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <aside className="card" data-fb="新專案卡">
          <h2>＋ 新專案</h2>
          {activeGroup && (
            <p className="hint" style={{ marginTop: -4 }}>
              將建立在：{activeGroup.teamName}・{activeGroup.groupName}（頂欄可切換）
            </p>
          )}
          <label htmlFor="np-title">專案名稱</label>
          <input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：見證故事 · 走出低谷" />
          <label htmlFor="np-kind">內容類型</label>
          <select id="np-kind" value={kind} onChange={(e) => setKind(e.target.value)} disabled={!kindOptions.length}>
            {kindOptions.map((k) => (
              <option key={k.id} value={k.value}>{k.label}</option>
            ))}
          </select>
          {options.isLoading && <p className="hint">選項載入中…</p>}
          {!options.isLoading && groupId && !kindOptions.length && (
            <p className="hint">這個組還沒有內容類型選項——請組長到「選項」頁新增。</p>
          )}
          <label htmlFor="np-platform">發布平台</label>
          <select id="np-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={!platformOptions.length}>
            {platformOptions.map((p) => (
              <option key={p.id} value={p.value}>{p.label}</option>
            ))}
          </select>
          {!options.isLoading && groupId && !platformOptions.length && (
            <p className="hint">這個組還沒有發布平台選項——請組長到「選項」頁新增。</p>
          )}
          {pickedPlatform?.format && <p className="hint">畫面格式：{pickedPlatform.format}（依平台自動帶入）</p>}
          <div style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={!title.trim() || !groupId || !kind || !platform || create.isPending}
              onClick={() => create.mutate({ groupId, title: title.trim(), kind, platform })}
            >
              {create.isPending ? "建立中…" : "建立專案"}
            </button>
            {!groupId && <p className="hint">（要先屬於一個組才能建專案）</p>}
          </div>
          {create.error && <p className="error">{create.error.message}</p>}
        </aside>
      </div>
    </div>
  );
}
