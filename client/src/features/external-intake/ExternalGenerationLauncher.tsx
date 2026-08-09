import { useMemo, useRef, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { useFocusTrap } from "../../components/interactions";
import { Button, Card, Hint, Meta } from "../../components/ui";
import { externalToolForTarget, type ExternalToolCapability } from "@shared/externalTools";

export function ExternalGenerationLauncher({
  projectId,
  sceneId,
  sceneLabel,
  prompt,
  referenceAssetIds = [],
  targetType = "video",
}: {
  projectId: string;
  sceneId?: string;
  sceneLabel?: string;
  prompt: string;
  referenceAssetIds?: string[];
  targetType?: "image" | "video" | "audio" | "music" | "text";
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyFallbackRef = useRef<HTMLTextAreaElement>(null);
  useFocusTrap(dialogRef, open, () => setOpen(false));
  const project = trpc.projects.get.useQuery({ id: projectId }, { enabled: open });
  const tools = trpc.externalIntake.tools.useQuery(
    { groupId: project.data?.groupId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: open && !!project.data?.groupId },
  );
  const prepare = trpc.externalIntake.prepareSession.useMutation();
  const markOpened = trpc.externalIntake.markOpened.useMutation();
  const saveTool = trpc.externalIntake.saveTool.useMutation({
    onSuccess: () => {
      void tools.refetch();
      setCustomName("");
      setCustomUrl("");
      setShowAdd(false);
      setStatus("✓ 已加入我的 AI 工具");
    },
  });
  const shown = useMemo(() => (tools.data ?? []).filter((tool) => externalToolForTarget(
    targetType,
    tool.capabilities as ExternalToolCapability[],
  )).sort((a, b) => Number(b.favorite) - Number(a.favorite)), [tools.data, targetType]);

  const launch = async (toolKey: string) => {
    if (!prompt.trim()) { setStatus("請先填好這一鏡的畫面描述。"); return; }
    const blank = window.open("about:blank", "_blank");
    if (!blank) {
      setStatus("瀏覽器封鎖了新分頁。請允許此網站開啟彈出式視窗後再試一次。");
      return;
    }
    try { blank.opener = null; } catch { /* Browser isolation is best-effort. */ }
    setCopyFallback("");
    setStatus("正在準備 Prompt 與參考素材…");
    try {
      const session = await prepare.mutateAsync({
        projectId,
        sceneId,
        targetType,
        externalTool: toolKey,
        prompt,
        referenceAssetIds,
      });
      let copied = false;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
        await navigator.clipboard.writeText(prompt);
        copied = true;
      } catch {
        setCopyFallback(prompt);
      }
      blank.location.href = session.externalUrl;
      await markOpened.mutateAsync({ sessionId: session.id });
      setStatus(copied
        ? `✓ Prompt 已複製，${session.externalToolName} 已開啟。完成後回來按「帶入成果」。`
        : `✓ ${session.externalToolName} 已開啟；瀏覽器未允許自動複製，請從下方手動複製 Prompt。`);
    } catch (caught) {
      blank?.close();
      setStatus(caught instanceof Error ? caught.message : "無法開啟外部工具");
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="準備 Prompt，前往你已訂閱的外部 AI">
        <Icon name="ArrowRight" size={13} /> 去外部 AI 生成
      </Button>
      {open && (
        <div className="modal-scrim" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <Card ref={dialogRef} className="modal-card external-launcher" role="dialog" aria-modal="true" aria-label="去哪裡生成">
            <div className="external-intake__head">
              <div><h2>去哪裡生成？</h2><Meta as="p" style={{ margin: 0 }}>{sceneLabel ?? "目前工作"}・不會使用 AI OS 點數</Meta></div>
              <Button size="sm" variant="ghost" aria-label="關閉" onClick={() => setOpen(false)}><Icon name="X" /></Button>
            </div>
            <Hint style={{ margin: "8px 0" }}>系統會複製 Prompt、記住這次是給哪個分鏡；不控制外部網站，也不讀取 Cookie。</Hint>
            <div className="external-launcher__tools">
              {shown.map((tool) => (
                <button key={tool.key} type="button" disabled={prepare.isPending} onClick={() => { void launch(tool.key); }}>
                  <strong>{tool.name}</strong>
                  <span>{tool.instructions}</span>
                  {tool.favorite && <small>常用</small>}
                </button>
              ))}
            </div>
            {copyFallback && (
              <div className="external-launcher__copy-fallback">
                <label htmlFor="external-launcher-prompt">待複製的 Prompt</label>
                <textarea
                  id="external-launcher-prompt"
                  ref={copyFallbackRef}
                  readOnly
                  value={copyFallback}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button size="sm" variant="primary" onClick={async () => {
                  let copied = false;
                  try {
                    if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
                    await navigator.clipboard.writeText(copyFallback);
                    copied = true;
                  } catch {
                    copyFallbackRef.current?.focus();
                    copyFallbackRef.current?.select();
                    try { copied = document.execCommand("copy"); } catch { copied = false; }
                  }
                  if (copied) {
                    setCopyFallback("");
                    setStatus("✓ Prompt 已複製。完成生成後，回來按「帶入成果」。");
                  } else {
                    setStatus("無法自動複製；Prompt 已全選，請按 Ctrl+C 或使用系統的複製指令。");
                  }
                }}>
                  <Icon name="Copy" size={12} /> 複製 Prompt
                </Button>
              </div>
            )}
            <div className="external-launcher__custom">
              <Button size="sm" variant="ghost" onClick={() => setShowAdd((value) => !value)}>
                <Icon name="Plus" size={12} /> 新增我的 AI
              </Button>
              {showAdd && (
                <div className="external-launcher__custom-form">
                  <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="工具名稱，例如公司 ComfyUI" aria-label="自訂 AI 工具名稱" />
                  <input value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://… 或 http://內部網址" aria-label="自訂 AI 工具網址" />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!project.data?.groupId || !customName.trim() || !customUrl.trim() || saveTool.isPending}
                    onClick={() => {
                      if (!project.data?.groupId) return;
                      saveTool.mutate({
                        groupId: project.data.groupId,
                        name: customName.trim(),
                        url: customUrl.trim(),
                        capabilities: [targetType],
                        favorite: true,
                      });
                    }}
                  >加入</Button>
                </div>
              )}
              {saveTool.error && <p className="error">{saveTool.error.message}</p>}
            </div>
            {status && <p role="status" className={status.startsWith("✓") ? "success" : "meta"}>{status}</p>}
          </Card>
        </div>
      )}
    </>
  );
}
