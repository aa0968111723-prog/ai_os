import { useMemo, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import {
  composePhoneGoal,
  derivePhoneCard,
  derivePhoneContextCapsule,
  resolvePhoneDestructiveTarget,
  type PhoneAssistantAction,
  type PhoneTargetCandidate,
} from "@shared/phoneAssistantProjection";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui";
import { composeToAssistant, openAssistantSurface } from "../lib/assistantCompose";
import { getAssistantQuickActions, toWirePageContext } from "../lib/assistantQuickActions";
import { useAssistantContext } from "../lib/assistantContext";
import { usePhoneAssistantTurn } from "../lib/phoneAssistantBridge";
import { PhoneAssistantCardView, PhoneContextCapsuleView, PhoneTargetChooser } from "./PhoneAssistantCards";

/**
 * 手機 AI Action-first 控制面（Phone UX，<768px）。
 *
 * ## 從「聊天入口」到「控制面」
 *
 * #766 的版本是一列輸入框＋快捷，送出後把話丟給既有助手。它解掉的是
 * 「AI 要放在拇指區」，沒有解掉的是：使用者送出後仍然只能讀一段散文，
 * 自己判斷發生了什麼、還缺什麼、下一步按哪裡。
 *
 * 這個版本在同一個位置多了三樣東西，而**沒有多一套助手**：
 *
 * 1. **上下文膠囊**：目前專案／幕／鏡就在輸入框上方，所以「這幕」看得見所指。
 * 2. **上下文補完**：在首頁說「把第二幕改成晚上」時，送出去的那句話會被補成
 *    「在「百日夢島」：把第二幕改成晚上」——補上去的字原樣進助手輸入框，
 *    使用者看得到（見 `composePhoneGoal` 檔頭；線上 pageContext 白名單不帶 projectId）。
 * 3. **工作卡**：助手那一輪的真實狀態（進度／待確認／結果）投影成一張卡，
 *    面板關著也看得到。
 *
 * ## 這裡仍然沒有第二套助手
 *
 * 沒有對話狀態、沒有 model 呼叫、沒有工具執行、沒有任何 mutation。
 * 送出走的仍是 `composeToAssistant()` → 既有 sheet → 既有意圖判定／能力路由／
 * 確認卡／執行與驗證。卡片上的每一顆按鈕只會做三件事之一：送出另一句話、
 * 打開既有面板、或導到一個唯讀畫面。**沒有一顆按鈕會自己寫入。**
 *
 * ## 為什麼這對手機的 initial load 仍然是安全的
 *
 * 卡片元件與投影都是純渲染／純函式，跟著 `MobileHome`／`MobileProjectPage`
 * 那個小 chunk 走；助手本體（AICreativeCopilot／ProjectAssistant）與完整工作台
 * 依舊是「按了才載」。渲染一張結果卡不會把 234KB 的工作台拉進來（計畫 §11）。
 */
export function MobileAiBar({
  placeholder = "想做什麼？直接跟 Aios 說",
  /** 額外插在情境快捷前面的一顆（例如專案頁的「接下來做什麼？」） */
  lead,
  /** 目前組別；用來讀組級助手那一輪的投影 */
  groupId,
  /** 目前專案（專案頁才有）；專案級助手那一輪優先於組級 */
  projectId,
  /** 專案／首頁已經算好的一句話進度，直接進膠囊，不另算一份 */
  statusLine,
  /** 專案名（首頁的「目前專案」也算——首頁路由沒有專案，但使用者心裡有） */
  projectTitle,
}: {
  placeholder?: string;
  lead?: { label: string; prompt: string };
  groupId?: string;
  projectId?: string;
  statusLine?: string;
  projectTitle?: string;
}) {
  const ctx = useAssistantContext();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  /** 攔下來的模糊刪除：有值＝正在問使用者要刪哪一個，且**尚未送出任何請求** */
  const [ambiguous, setAmbiguous] = useState<{ text: string; candidates: PhoneTargetCandidate[] } | null>(null);
  // 頁面情境快捷最多 4 顆；有 lead 時留一格給它，總數仍守住「不做成滿版功能選單」
  const contextual = getAssistantQuickActions(ctx).slice(0, lead ? 3 : 4);

  const capsule = useMemo(
    () => derivePhoneContextCapsule({
      projectTitle: projectTitle ?? ctx.projectTitle,
      page: toWirePageContext(ctx),
      statusLine,
    }),
    [projectTitle, ctx, statusLine],
  );

  const turn = usePhoneAssistantTurn({ groupId, projectId });
  const card = useMemo(
    () => (turn
      ? derivePhoneCard({
        answer: turn.answer,
        events: turn.events,
        pendingProposals: turn.pendingProposals,
        activeGoal: turn.activeGoal,
        pendingInteraction: turn.pendingInteraction,
        results: turn.results,
        running: turn.running,
        projectId,
      })
      : null),
    [turn, projectId],
  );

  /**
   * 目前畫面上「合理的刪除對象」。
   *
   * 只認**使用者自己造成的焦點**：明確勾選的多筆，或正在看的那一個。
   * 刻意不把「最近素材」「最近專案」也列進來——那不是使用者指的東西，
   * 把它列成選項等於在誘導一個沒有人要的刪除。
   */
  const targetCandidates = useMemo<PhoneTargetCandidate[]>(() => {
    const selected = ctx.selectedEntityIds ?? [];
    if (selected.length > 1) {
      return selected.map((id, index) => ({ id, label: `${ctx.entityLabel ?? "選取項"} ${index + 1}` }));
    }
    const candidates: PhoneTargetCandidate[] = [];
    if (ctx.entityId && ctx.entityLabel) candidates.push({ id: ctx.entityId, label: ctx.entityLabel });
    if (projectId && (projectTitle ?? ctx.projectTitle)) {
      candidates.push({ id: projectId, label: (projectTitle ?? ctx.projectTitle)! });
    }
    return candidates;
  }, [ctx.selectedEntityIds, ctx.entityId, ctx.entityLabel, ctx.projectTitle, projectId, projectTitle]);

  const send = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // 模糊的刪除目標不准猜（計畫 §16 Flow F）：連唯讀請求都不送，
    // 否則這句指涉不明的話會留在對話裡，下一輪的「就這個」會指到它。
    const resolution = resolvePhoneDestructiveTarget(trimmed, targetCandidates);
    if (resolution.status === "needs_choice") {
      setAmbiguous({ text: trimmed, candidates: resolution.candidates });
      return;
    }
    setAmbiguous(null);
    composeToAssistant(composePhoneGoal(trimmed, capsule));
    setText("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(text);
  };

  /**
   * 卡片按鈕：三種且僅三種。
   * `navigate` 只導到唯讀畫面——導航成功永遠不會被當成任務成功（計畫 §7）。
   */
  const runAction = (action: PhoneAssistantAction) => {
    if (action.kind === "compose" && action.prompt) {
      composeToAssistant(composePhoneGoal(action.prompt, capsule));
      return;
    }
    if (action.kind === "navigate" && action.href) {
      navigate(action.href);
      return;
    }
    openAssistantSurface();
  };

  return (
    <section className="m-ai" aria-label="問 Aios">
      <PhoneContextCapsuleView capsule={capsule} />

      {ambiguous ? (
        <PhoneTargetChooser
          candidates={ambiguous.candidates}
          onPick={(candidate) => {
            const chosen = ambiguous.text;
            setAmbiguous(null);
            setText("");
            // 指名之後才送出：句子裡帶著使用者自己選的那個名字，助手端仍會重新解析。
            composeToAssistant(`${chosen}——我指的是「${candidate.label}」`);
          }}
          onCancel={() => setAmbiguous(null)}
        />
      ) : card ? (
        <PhoneAssistantCardView card={card} onRun={runAction} />
      ) : null}

      <form className="m-ai__form" onSubmit={onSubmit}>
        <Icon name="Sparkles" size={16} />
        <input
          className="m-ai__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="跟 Aios 說一句話"
          enterKeyHint="send"
        />
        <Button
          variant="primary"
          size="sm"
          type="submit"
          className="m-ai__send"
          disabled={!text.trim()}
          aria-label="送出給 Aios"
        >
          <Icon name="ArrowRight" size={15} />
        </Button>
      </form>
      <div className="m-ai__quick">
        {lead && (
          <button type="button" className="m-ai__chip m-ai__chip--lead" onClick={() => send(lead.prompt)}>
            {lead.label}
          </button>
        )}
        {contextual.map((action) => (
          <button key={action.id} type="button" className="m-ai__chip" onClick={() => send(action.prompt)}>
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
