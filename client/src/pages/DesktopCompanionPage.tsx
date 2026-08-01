import { useEffect, useMemo, useState } from "react";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import {
  detectDesktopEditors,
  editorKindForAsset,
  hasDesktopBridge,
  openAssetInExternalEditor,
  revealAssetInFolder,
  stopDesktopHandoff,
  suggestedFileName,
  type DetectedDesktopEditor,
} from "../platform/desktopBridge";
import type { DesktopHandoffStatusEvent, DesktopRevisionEvent } from "../platform/tauriDesktop";
import { Button, Card, EmptyState, Hint, Meta } from "../components/ui";

type HandoffPhase = DesktopHandoffStatusEvent["phase"];

const PHASE_STEPS: { phase: HandoffPhase; label: string }[] = [
  { phase: "downloading", label: "下載" },
  { phase: "launched", label: "開啟" },
  { phase: "watching", label: "監看" },
  { phase: "uploading", label: "回傳" },
  { phase: "uploaded", label: "完成" },
];

const PHASE_LABELS: Record<HandoffPhase, string> = {
  downloading: "下載中",
  downloaded: "已下載",
  launched: "已開啟軟體",
  watching: "監看儲存",
  uploading: "回傳中",
  uploaded: "已回傳",
  error: "發生錯誤",
  stopped: "已停止",
};

/** 事件未帶 percent 時，依 phase 給 UI 合理預設進度。 */
export function defaultPercentForPhase(phase: HandoffPhase): number | undefined {
  switch (phase) {
    case "downloading":
      return 15;
    case "downloaded":
      return 45;
    case "launched":
      return 55;
    case "watching":
      return 70;
    case "uploading":
      return 85;
    case "uploaded":
      return 100;
    case "error":
    case "stopped":
      return undefined;
    default:
      return undefined;
  }
}

function stepIndexForPhase(phase: HandoffPhase): number {
  if (phase === "downloaded") return 0;
  if (phase === "error" || phase === "stopped") return -1;
  const idx = PHASE_STEPS.findIndex((s) => s.phase === phase);
  return idx;
}

export function DesktopCompanionPage() {
  const desktopAvailable = hasDesktopBridge();
  const projects = trpc.projects.list.useQuery({});
  const [projectId, setProjectId] = useState("");
  const assets = trpc.projects.assets.useQuery(
    { projectId, limit: 500 },
    { enabled: desktopAvailable && !!projectId },
  );
  const [editors, setEditors] = useState<DetectedDesktopEditor[]>([]);
  const [assetId, setAssetId] = useState("");
  const [editorId, setEditorId] = useState("");
  const [activeHandoffId, setActiveHandoffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [handoffPhase, setHandoffPhase] = useState<HandoffPhase | null>(null);
  const [handoffPercent, setHandoffPercent] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!projectId && projects.data?.[0]?.id) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);

  useEffect(() => {
    if (!assetId && assets.data?.[0]?.id) setAssetId(assets.data[0].id);
  }, [assetId, assets.data]);

  useEffect(() => {
    if (!desktopAvailable) return;
    void detectDesktopEditors().then(setEditors);
  }, [desktopAvailable]);

  const selectedAsset = assets.data?.find((asset) => asset.id === assetId) ?? null;
  const neededKind = selectedAsset ? editorKindForAsset(selectedAsset.kind) : "system-default";
  const matchingEditors = useMemo(
    () => editors.filter((editor) => editor.kind === neededKind || editor.kind === "system-default"),
    [editors, neededKind],
  );

  useEffect(() => {
    if (!matchingEditors.some((editor) => editor.id === editorId)) {
      setEditorId(matchingEditors[0]?.id ?? "");
    }
  }, [editorId, matchingEditors]);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<DesktopHandoffStatusEvent>).detail;
      if (!detail) return;
      if (detail.projectId && detail.projectId !== projectId) return;
      if (detail.handoffId) setActiveHandoffId(detail.handoffId);
      setHandoffPhase(detail.phase);
      setHandoffPercent(
        typeof detail.percent === "number" ? detail.percent : defaultPercentForPhase(detail.phase),
      );
      setError(detail.phase === "error" ? detail.message : "");
      setMessage(detail.phase === "error" ? "" : detail.message);
    };
    const onRevision = (event: Event) => {
      const detail = (event as CustomEvent<DesktopRevisionEvent>).detail;
      if (detail.projectId !== projectId) return;
      setHandoffPhase("uploaded");
      setHandoffPercent(100);
      setMessage(`已回傳新素材${detail.title ? `「${detail.title}」` : ""}，原始素材仍保留。`);
      void assets.refetch();
    };
    window.addEventListener("aios:desktop-handoff-status", onStatus);
    window.addEventListener("aios:asset-revision-uploaded", onRevision);
    return () => {
      window.removeEventListener("aios:desktop-handoff-status", onStatus);
      window.removeEventListener("aios:asset-revision-uploaded", onRevision);
    };
  }, [assets, projectId]);

  const openSelected = async () => {
    if (!selectedAsset || !editorId) return;
    setBusy(true);
    setError("");
    setHandoffPhase("downloading");
    setHandoffPercent(0);
    setMessage("正在準備本機交接…");
    try {
      const result = await openAssetInExternalEditor({
        assetId: selectedAsset.id,
        projectId,
        editorKind: neededKind,
        editorId,
        suggestedName: suggestedFileName(selectedAsset),
        returnPath: `/p/${projectId}?tab=assets`,
      });
      if (!result.ok) {
        setError(result.message);
        setMessage("");
        setHandoffPhase("error");
        setHandoffPercent(undefined);
        return;
      }
      if (result.handoffId) setActiveHandoffId(result.handoffId);
      setMessage("已啟動外部軟體。儲存檔案後，Aios 會在內容穩定時自動回傳新素材版本。");
      if (!handoffPhase || handoffPhase === "downloading") {
        setHandoffPhase("launched");
        setHandoffPercent(defaultPercentForPhase("launched"));
      }
    } finally {
      setBusy(false);
    }
  };

  const revealSelected = async () => {
    if (!selectedAsset) return;
    const result = await revealAssetInFolder({ assetId: selectedAsset.id, projectId });
    if (!result.ok) setError(result.message);
  };

  const stopWatching = async () => {
    if (!activeHandoffId) return;
    const result = await stopDesktopHandoff(activeHandoffId);
    if (result.ok) {
      setMessage("已停止這次編輯檔監看；本機檔案仍保留。");
      setActiveHandoffId("");
      setHandoffPhase("stopped");
      setHandoffPercent(undefined);
    } else {
      setError(result.message);
    }
  };

  const activeStep = handoffPhase ? stepIndexForPhase(handoffPhase) : -1;
  const showProgress =
    handoffPhase != null && handoffPhase !== "error" && handoffPhase !== "stopped";
  const displayPercent =
    typeof handoffPercent === "number"
      ? handoffPercent
      : handoffPhase
        ? defaultPercentForPhase(handoffPhase)
        : undefined;

  if (!desktopAvailable) {
    return (
      <Card as="section" style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2>桌面剪輯連接</h2>
        <EmptyState
          icon={<Icon name="Monitor" />}
          title={<>這項功能需要 Aios 桌面版</>}
          description={<>一般瀏覽器與 PWA 不會取得啟動本機剪輯軟體或監看檔案的權限。你仍可從素材庫下載後手動開啟。</>}
        />
      </Card>
    );
  }

  return (
    <section className="stack desktop-companion" style={{ maxWidth: 900, margin: "0 auto" }}>
      <Card>
        <h2>桌面剪輯連接</h2>
        <Hint layer="always">
          選擇專案素材與電腦中已安裝的軟體。Aios 只會把素材下載到自己的本機快取；儲存修改後會上傳成新素材，不覆寫原檔。
        </Hint>
      </Card>

      {(handoffPhase || message || error || activeHandoffId) && (
        <Card className="desktop-handoff-status" aria-live="polite">
          <div className="desktop-handoff-status__head">
            <h3 style={{ margin: 0, fontSize: "var(--fs-15)" }}>交接狀態</h3>
            {handoffPhase && (
              <span
                className={`desktop-handoff-status__badge${
                  handoffPhase === "error"
                    ? " is-error"
                    : handoffPhase === "uploaded"
                      ? " is-done"
                      : handoffPhase === "stopped"
                        ? " is-stopped"
                        : " is-active"
                }`}
              >
                {PHASE_LABELS[handoffPhase]}
              </span>
            )}
          </div>

          <ol className="desktop-handoff-phases" aria-label="交接階段">
            {PHASE_STEPS.map((step, i) => {
              const done = activeStep > i || handoffPhase === "uploaded";
              const current = activeStep === i && handoffPhase !== "uploaded";
              return (
                <li
                  key={step.phase}
                  className={
                    done ? "is-done" : current ? "is-current" : undefined
                  }
                  aria-current={current ? "step" : undefined}
                >
                  <span className="desktop-handoff-phases__dot" aria-hidden="true" />
                  {step.label}
                </li>
              );
            })}
          </ol>

          {showProgress && typeof displayPercent === "number" && (
            <div
              className="desktop-handoff-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={displayPercent}
              aria-label="交接進度"
            >
              <div className="desktop-handoff-progress__track">
                <span style={{ width: `${displayPercent}%` }} />
              </div>
              <Meta as="span" className="desktop-handoff-progress__pct">
                {displayPercent}%
              </Meta>
            </div>
          )}

          {message && (
            <Meta as="p" role="status" style={{ margin: "8px 0 0" }}>
              {message}
            </Meta>
          )}
          {error && (
            <p className="error" role="alert" style={{ margin: "8px 0 0" }}>
              {error}
            </p>
          )}
          {activeHandoffId && (
            <Meta as="p" style={{ margin: "6px 0 0", fontSize: "var(--fs-11)" }}>
              交接 ID：{activeHandoffId.slice(0, 8)}…
            </Meta>
          )}
        </Card>
      )}

      <Card className="stack">
        <label>
          專案
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setAssetId("");
              setActiveHandoffId("");
              setHandoffPhase(null);
              setHandoffPercent(undefined);
              setMessage("");
              setError("");
            }}
          >
            <option value="">選擇專案</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          素材
          <select
            value={assetId}
            onChange={(event) => {
              setAssetId(event.target.value);
              setActiveHandoffId("");
            }}
            disabled={!projectId || assets.isLoading}
          >
            <option value="">{assets.isLoading ? "載入中…" : "選擇素材"}</option>
            {(assets.data ?? []).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}・{asset.kind}
              </option>
            ))}
          </select>
        </label>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>開啟軟體</legend>
          {matchingEditors.length === 0 ? (
            <Hint layer="always">沒有偵測到符合這類素材的軟體。</Hint>
          ) : (
            <div className="desktop-editor-picker" role="radiogroup" aria-label="選擇剪輯軟體">
              {matchingEditors.map((editor) => (
                <label key={editor.id} className={`chip pick ${editorId === editor.id ? "on" : ""}`}>
                  <input
                    type="radio"
                    name="desktop-editor"
                    value={editor.id}
                    checked={editorId === editor.id}
                    onChange={() => setEditorId(editor.id)}
                    style={{ marginRight: 6 }}
                  />
                  {editor.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            className="primary"
            type="button"
            disabled={!selectedAsset || !editorId || busy}
            onClick={() => void openSelected()}
          >
            {busy ? (
              <>
                <Icon name="Loader" className="spin" size={14} /> 準備中…
              </>
            ) : (
              "用外部軟體開啟並監看"
            )}
          </button>
          <button type="button" disabled={!selectedAsset} onClick={() => void revealSelected()}>
            在 Finder／檔案總管顯示
          </button>
          {activeHandoffId && (
            <Button variant="ghost" onClick={() => void stopWatching()}>
              停止自動回傳
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h3>目前偵測到的桌面程式</h3>
        {editors.length === 0 ? (
          <Hint layer="always">尚未偵測到已安裝的剪輯／影像軟體。</Hint>
        ) : (
          <ul className="desktop-editor-list">
            {editors.map((editor) => (
              <li key={editor.id}>
                {editor.name}
                <Meta as="span" style={{ marginLeft: 6 }}>
                  （{editor.kind}）
                </Meta>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
