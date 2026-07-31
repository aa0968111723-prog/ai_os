import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, EmptyState, Hint, Meta } from "../components/ui";

/** 與 sw.js 的 Web Share Target 交握契約（SHARE_CACHE 命名空間） */
const SHARE_CACHE = "aios-share-inbox";
const META_KEY = "/share-payload/meta";

type ShareMetaFile = { key: string; name: string; type: string; size: number };
type ShareMeta = { title: string; text: string; url: string; at: number; files: ShareMetaFile[] };
type Inbox = { meta: ShareMeta; files: File[] };

/** 從 SW 暫存區讀出這批分享（頁面重整仍在；認領成功後清空） */
async function readShareInbox(): Promise<Inbox | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match(META_KEY);
    if (!metaRes) return null;
    const meta = (await metaRes.json()) as ShareMeta;
    const files: File[] = [];
    for (const f of meta.files ?? []) {
      const res = await cache.match(f.key);
      if (!res) continue;
      const blob = await res.blob();
      files.push(new File([blob], f.name, { type: f.type || blob.type }));
    }
    return { meta, files };
  } catch {
    return null;
  }
}

async function clearShareInbox(): Promise<void> {
  try {
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);
  } catch { /* 清不掉就留著，下一批分享會覆蓋 */ }
}

function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Dest = "project" | "dm" | "note";

export function ShareTargetPage({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [inbox, setInbox] = useState<Inbox | null | "loading">("loading");
  const [dest, setDest] = useState<Dest>("project");
  const [projectId, setProjectId] = useState("");
  const [peerId, setPeerId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void readShareInbox().then((got) => {
      setInbox(got);
      // 分享文字／連結預填成附言（傳夥伴時）；純文字分享沒有檔案可存專案
      const text = [got?.meta.title, got?.meta.text, got?.meta.url].filter(Boolean).join("\n");
      if (text) setNote(text);
      if (got && got.files.length === 0) setDest("note"); // 純文字＝靈感，預設存給自己（無組時 UI 會自動回落）
    });
  }, []);

  const projects = trpc.projects.list.useQuery(
    { groupId: groupId || undefined },
    { enabled: !!groupId },
  );
  const peers = trpc.dm.peers.useQuery();
  const send = trpc.dm.send.useMutation();
  const addNote = trpc.notes.add.useMutation();

  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);
  useEffect(() => {
    if (!peerId && peers.data?.length) setPeerId(peers.data[0].userId);
  }, [peers.data, peerId]);

  const files = useMemo(
    () => (inbox !== "loading" && inbox ? inbox.files : []),
    [inbox],
  );
  // 縮圖 object URL 用 effect 管生命週期（建立與撤銷成對）——放 useMemo 裡的撤銷副作用
  // 會在 StrictMode 雙重呼叫時把活的 URL 撤掉，縮圖全數破圖
  const [previews, setPreviews] = useState<(string | null)[]>([]);
  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null));
    setPreviews(urls);
    return () => urls.forEach((u) => { if (u) URL.revokeObjectURL(u); });
  }, [files]);

  const canSave =
    !busy
    && (dest === "project"
      ? !!projectId && files.length > 0
      : dest === "note"
        ? !!groupId && note.trim().length > 0
        : !!peerId && (files.length > 0 || note.trim().length > 0));

  /** 存進專案素材庫：逐檔 POST /api/upload（與素材庫上傳同一條線） */
  const saveToProject = async () => {
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setStep(files.length > 1 ? `上傳中…（${i + 1}/${files.length}）` : "上傳中…");
      try {
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) failed.push(`${file.name}：${data.error ?? `上傳失敗（${res.status}）`}`);
      } catch {
        failed.push(`${file.name}：上傳失敗——請檢查網路後重試`);
      }
    }
    if (failed.length) throw new Error(failed.join("；"));
    utils.projects.assets.invalidate({ projectId });
    // 附言不丟失：有寫就順手存成該專案的筆記（先前會被靜默丟棄）
    if (note.trim() && groupId) {
      await addNote.mutateAsync({
        groupId,
        projectId,
        title: note.trim().slice(0, 20) || "分享附言",
        content: note.trim(),
      }).catch(() => { /* 筆記失敗不擋素材已入庫的主流程 */ });
    }
    await clearShareInbox();
    navigate(`/p/${projectId}`);
  };

  /** 傳給夥伴：逐檔走私訊附件（/api/dm/upload → dm.send）；附言只跟第一則 */
  const sendToPeer = async () => {
    const failed: string[] = [];
    let sentAny = false;
    for (const [i, file] of files.entries()) {
      setStep(files.length > 1 ? `傳送中…（${i + 1}/${files.length}）` : "傳送中…");
      try {
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("peerId", peerId);
        const res = await fetch("/api/dm/upload", { method: "POST", body: fd, credentials: "same-origin" });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `上傳失敗（${res.status}）`);
        }
        const data = (await res.json()) as { attachment: { id: string } };
        await send.mutateAsync({ peerId, body: sentAny ? "" : note.trim(), attachmentId: data.attachment.id });
        sentAny = true;
      } catch (err) {
        failed.push(`${file.name}：${err instanceof Error ? err.message : "傳送失敗"}`);
      }
    }
    if (!files.length && note.trim()) {
      setStep("傳送中…");
      await send.mutateAsync({ peerId, body: note.trim() });
      sentAny = true;
    }
    if (failed.length) throw new Error(failed.join("；"));
    if (sentAny) {
      utils.dm.history.invalidate({ peerId });
      utils.dm.threads.invalidate();
    }
    await clearShareInbox();
    navigate(`/chat/${peerId}`);
  };

  /** 存成靈感筆記：純文字分享的最短路（存給自己，不必先想去處或挑夥伴） */
  const saveToNote = async () => {
    setStep("儲存中…");
    await addNote.mutateAsync({
      groupId,
      title: note.trim().slice(0, 20) || "分享靈感",
      content: note.trim(),
    });
    await clearShareInbox();
    navigate("/planner");
  };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      if (dest === "project") await saveToProject();
      else if (dest === "note") await saveToNote();
      else await sendToPeer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗，請再試一次。");
      setBusy(false);
      setStep("");
    }
  };

  return (
    <div className="page-shell secondary-page share-target-page">
      <SecondaryPageHeader
        eyebrow="分享收件"
        title="把分享的內容存進 Aios"
        icon="Download"
        description={<>從相簿或其他 App 分享過來的檔案會先到這裡——選好去處再一鍵存入。</>}
      />
      {inbox === "loading" ? (
        <Meta as="p">讀取分享內容…</Meta>
      ) : !inbox || (files.length === 0 && !note.trim()) ? (
        <EmptyState
          icon={<Icon name="Download" />}
          title={<>目前沒有待存的分享</>}
          description={<>Android：相簿或其他 App 選檔案 → 分享 → 選「Aios」，內容會出現在這裡（需先安裝到主畫面）。iPhone 不支援分享進 App——請改用私訊／素材庫的「拍照」與選檔上傳。</>}
          action={<Button onClick={() => navigate("/dashboard")}>回今日工作台</Button>}
        />
      ) : (
        <div className="stack">
          <Card as="section" aria-label="分享內容">
            <h2>這批分享（{files.length ? `${files.length} 個檔案` : "文字內容"}）</h2>
            {files.length > 0 && (
              <ul className="share-target-files">
                {files.map((f, i) => (
                  <li key={i}>
                    {previews[i] ? (
                      <img src={previews[i]!} alt="" />
                    ) : (
                      <span className="share-target-files__icon">
                        <Icon name={f.type.startsWith("video/") ? "Film" : f.type.startsWith("audio/") ? "Mic" : "FileText"} size={18} />
                      </span>
                    )}
                    <span className="share-target-files__name">{f.name}</span>
                    <Meta as="span">{fmtSize(f.size)}</Meta>
                  </li>
                ))}
              </ul>
            )}
            <label htmlFor="share-note">附言（傳給夥伴時一併送出）</label>
            <textarea id="share-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="想說的話（可留空）" />
          </Card>

          <Card as="section" aria-label="選擇去處">
            <h2>存到哪裡？</h2>
            <div role="radiogroup" aria-label="分享去處" className="share-target-dest">
              <Button
                variant={dest === "project" ? "primary" : "neutral"}
                role="radio"
                aria-checked={dest === "project"}
                disabled={files.length === 0}
                onClick={() => setDest("project")}
              >
                <Icon name="Package" size={14} /> 存進專案素材庫
              </Button>
              <Button
                variant={dest === "note" ? "primary" : "neutral"}
                role="radio"
                aria-checked={dest === "note"}
                disabled={!groupId || files.length > 0}
                onClick={() => setDest("note")}
              >
                <Icon name="FileText" size={14} /> 存成靈感筆記
              </Button>
              <Button
                variant={dest === "dm" ? "primary" : "neutral"}
                role="radio"
                aria-checked={dest === "dm"}
                onClick={() => setDest("dm")}
              >
                <Icon name="MessageCircle" size={14} /> 傳給夥伴
              </Button>
            </div>
            {files.length === 0 && (
              <Hint layer="always">純文字／連結：存成筆記（給自己）或傳給夥伴；要進素材庫請分享檔案。</Hint>
            )}

            {dest === "project" ? (
              !groupId ? (
                <Hint layer="always">你還沒被分進任何組別，暫時無法存進專案——可以先「傳給夥伴」。</Hint>
              ) : projects.isLoading ? (
                <Meta as="p">載入專案清單…</Meta>
              ) : !projects.data?.length ? (
                <Hint layer="always">目前組別還沒有專案——請先到今日工作台建立專案，或改「傳給夥伴」。</Hint>
              ) : (
                <>
                  <label htmlFor="share-project">選擇專案</label>
                  <select id="share-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    {projects.data.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                  <Hint layer="always">檔案會進該專案的素材庫，之後可直接拿來生成、排分鏡或打包交付。</Hint>
                </>
              )
            ) : dest === "note" ? (
              <Hint layer="always">會存進「筆記排程」的共用筆記（附言全文即內容）——通勤路上的靈感先落地，之後再整理。</Hint>
            ) : peers.isLoading ? (
              <Meta as="p">載入夥伴清單…</Meta>
            ) : !peers.data?.length ? (
              <Hint layer="always">目前沒有可私訊的夥伴。</Hint>
            ) : (
              <>
                <label htmlFor="share-peer">選擇夥伴</label>
                <select id="share-peer" value={peerId} onChange={(e) => setPeerId(e.target.value)}>
                  {peers.data.map((p) => (
                    <option key={p.userId} value={p.userId}>{p.name}</option>
                  ))}
                </select>
                <Hint layer="always">會以私訊傳送，只有你和對方看得到。</Hint>
              </>
            )}

            {error && <p className="error" role="alert">{error}</p>}
            <div className="share-target-actions">
              <Button variant="primary" disabled={!canSave} onClick={() => void submit()}>
                {busy ? (step || "處理中…") : dest === "project" ? "存進素材庫" : dest === "note" ? "存成筆記" : "傳送私訊"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => { void clearShareInbox().then(() => navigate("/dashboard")); }}
              >
                捨棄這批分享
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
