import { useMemo, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, EmptyState, Hint, Meta } from "../../components/ui";
import {
  CONTEXT_PRIORITY_LABEL,
  CONTEXT_ROLES,
  CONTEXT_ROLE_LABEL,
  CONTEXT_SCOPE_LABEL,
  CONTEXT_SOURCE_LABEL,
  type ContextPriority,
  type ContextRole,
  type ContextScopeType,
  type ContextSource,
} from "@shared/projectContext";

/**
 * 「專案資料」／「專案脈絡」——一個入口看完這個專案在用哪些資料。
 *
 * 在這之前使用者得自己在知識庫、素材庫、資料表、資料中心四個地方各找一次，
 * 而且沒有任何地方回答得了「這份照片在這個專案裡算什麼」。
 *
 * ★ 這個面板不複製任何原始檔案——加入＝建立引用（context_bindings）。
 * ★ AI 建議與使用者確認在畫面上永遠分開；按了「加入」才會變成已確認（§23／§36）。
 */

/** 顯示分組：核心資料 → 人物／場景 → 參考 → 研究／交付。與 prompt 的優先序同一套語彙。 */
const ROLE_GROUPS: Array<{ title: string; roles: readonly ContextRole[] }> = [
  { title: "核心資料", roles: ["STORY_SOURCE", "SCRIPT_SOURCE", "WORLD_BUILDING", "STYLE_REFERENCE"] },
  { title: "人物與場景", roles: ["CHARACTER_REFERENCE", "LOCATION_REFERENCE"] },
  { title: "參考素材", roles: ["VISUAL_REFERENCE", "AUDIO_REFERENCE"] },
  { title: "研究與交付", roles: ["RESEARCH", "PRODUCTION_ASSET", "DELIVERY_ASSET"] },
];

export interface ProjectContextScope {
  scopeType: ContextScopeType;
  /** scene（story_scenes.id）或 shot（scenes.id）；project 範圍不需要 */
  scopeId?: string | null;
  label?: string;
}

export function ProjectContextPanel({ projectId, scope, canEdit = true }: {
  projectId: string;
  /** 預設看整個專案；Scene／Shot 面板傳入自己的範圍 */
  scope?: ProjectContextScope;
  canEdit?: boolean;
}) {
  const utils = trpc.useUtils();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const scopeType = scope?.scopeType ?? "project";
  const sceneId = scopeType === "scene" ? scope?.scopeId ?? undefined : undefined;
  const shotId = scopeType === "shot" ? scope?.scopeId ?? undefined : undefined;

  const list = trpc.projectContext.list.useQuery(
    { projectId, sceneId, shotId },
    { staleTime: 10_000 },
  );
  const suggestions = trpc.projectContext.suggestions.useQuery(
    { projectId, limit: 40 },
    { enabled: showSuggestions, staleTime: 60_000 },
  );

  const invalidate = () => {
    void utils.projectContext.list.invalidate({ projectId, sceneId, shotId });
    void utils.projectContext.suggestions.invalidate({ projectId });
  };
  const remove = trpc.projectContext.remove.useMutation({ onSuccess: invalidate });
  const setPrimary = trpc.projectContext.setPrimary.useMutation({ onSuccess: invalidate });
  const accept = trpc.projectContext.acceptSuggestions.useMutation({ onSuccess: invalidate });

  const effective = list.data?.effective ?? [];
  const byRole = useMemo(() => {
    const map = new Map<ContextRole, typeof effective>();
    for (const entry of effective) {
      map.set(entry.role as ContextRole, [...(map.get(entry.role as ContextRole) ?? []), entry]);
    }
    return map;
  }, [effective]);

  const scopeLabel = scope?.label ?? CONTEXT_SCOPE_LABEL[scopeType];
  const suggestionCount = list.data?.suggestionCount ?? 0;

  return (
    <section className="project-context" aria-label={`${scopeLabel}使用的資料`}>
      <header className="project-context__head">
        <div>
          <strong><Icon name="Sparkles" size={15} /> {scopeType === "project" ? "專案資料" : `${scopeLabel}使用的資料`}</strong>
          <Meta>
            {effective.length
              ? `${effective.length} 份資料・AI 生成與問答時會依 分鏡 → 場景 → 專案 的順序使用`
              : "還沒有指定資料——AI 會退回整個資料中心搜尋"}
          </Meta>
        </div>
        <Button size="sm" variant={showSuggestions ? "ghost" : "tonal"} onClick={() => setShowSuggestions((value) => !value)}>
          <Icon name="Sparkles" size={14} /> AI 建議{suggestionCount > 0 ? ` ${suggestionCount}` : ""}
        </Button>
      </header>

      {list.error && <p className="error" role="alert">讀取專案資料失敗：{list.error.message}</p>}

      {showSuggestions && (
        <Card variant="quiet" className="project-context__suggestions">
          {suggestions.isLoading ? <Meta as="p" role="status">AI 正在從資料中心找可能相關的資料…</Meta> : (
            (suggestions.data?.suggestions.length ?? 0) === 0 ? (
              <Meta as="p">目前沒有找到明顯相關的資料。等專案有故事、腳本或角色之後會更準。</Meta>
            ) : (
              <>
                <p className="project-context__suggestions-head">
                  AI 找到 {suggestions.data!.suggestions.length} 項可能相關的資料
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!canEdit || accept.isPending}
                    onClick={() => accept.mutate({
                      projectId,
                      scopeType,
                      scopeId: scope?.scopeId ?? undefined,
                      items: suggestions.data!.suggestions.map((item) => ({
                        resourceKind: item.resourceKind as "asset" | "knowledge" | "document" | "table",
                        resourceId: item.resourceId,
                        role: item.role,
                        priority: "SECONDARY" as ContextPriority,
                      })),
                    })}
                  >全部加入</Button>
                </p>
                <ul className="project-context__list">
                  {suggestions.data!.suggestions.map((item) => (
                    <li key={`${item.resourceKind}:${item.resourceId}`}>
                      <span className="project-context__item">
                        <strong>{item.title}</strong>
                        <small>{CONTEXT_ROLE_LABEL[item.role]}・{item.reason}{item.category ? `・${item.category}` : ""}</small>
                      </span>
                      <Badge>AI 建議 {Math.round(item.score * 100)}%</Badge>
                      <Button
                        size="sm"
                        disabled={!canEdit || accept.isPending}
                        onClick={() => accept.mutate({
                          projectId,
                          scopeType,
                          scopeId: scope?.scopeId ?? undefined,
                          items: [{
                            resourceKind: item.resourceKind as "asset" | "knowledge" | "document" | "table",
                            resourceId: item.resourceId,
                            role: item.role,
                            priority: "SECONDARY",
                          }],
                        })}
                      >加入</Button>
                    </li>
                  ))}
                </ul>
                <Hint style={{ margin: 0 }}>
                  AI 建議不會自己變成專案資料——按下「加入」才算數。加入的是引用，不會複製原始檔案。
                </Hint>
              </>
            )
          )}
        </Card>
      )}

      {list.isLoading ? <Meta as="p" role="status">正在讀取專案資料…</Meta>
        : effective.length === 0 && !showSuggestions ? (
          <EmptyState
            icon={<Icon name="Database" />}
            title={<>這個{scopeLabel}還沒有指定資料</>}
            description={<>指定之後，AI 生成與問答就會優先使用它們，而不是每次都去搜尋整個資料中心。</>}
            action={<Button variant="primary" onClick={() => setShowSuggestions(true)}><Icon name="Sparkles" size={15} /> 讓 AI 找找看</Button>}
          />
        ) : (
          ROLE_GROUPS.map((group) => {
            const entries = group.roles.flatMap((role) => byRole.get(role) ?? []);
            if (!entries.length) return null;
            return (
              <section key={group.title} className="project-context__group">
                <p className="hub-list__title">{group.title}</p>
                <ul className="project-context__list">
                  {entries.map((entry) => (
                    <li key={entry.bindingId}>
                      <span className="project-context__item">
                        <strong>{entry.resource.title}</strong>
                        <small>
                          {CONTEXT_ROLE_LABEL[entry.role as ContextRole]}
                          ・{CONTEXT_PRIORITY_LABEL[entry.priority as ContextPriority]}
                          ・{CONTEXT_SOURCE_LABEL[entry.effectiveSource as ContextSource]}
                          {entry.fromScope !== scopeType ? `（繼承自${CONTEXT_SCOPE_LABEL[entry.fromScope as ContextScopeType]}）` : ""}
                        </small>
                      </span>
                      {entry.priority === "PRIMARY" && <Badge>主要參考</Badge>}
                      {!entry.confirmedByUser && <Badge>AI 建議</Badge>}
                      {canEdit && entry.priority !== "PRIMARY" && entry.fromScope === scopeType && (
                        <Button size="sm" variant="ghost" disabled={setPrimary.isPending}
                          onClick={() => setPrimary.mutate({ bindingId: entry.bindingId })}>設為主要</Button>
                      )}
                      {canEdit && entry.fromScope === scopeType && (
                        <Button size="sm" variant="ghost" disabled={remove.isPending}
                          onClick={() => remove.mutate({ bindingId: entry.bindingId })}>移除</Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}

      {scopeType !== "project" && effective.some((entry) => entry.fromScope !== scopeType) && (
        <Hint style={{ margin: 0 }}>
          標「繼承自…」的資料來自上一層。要讓這個{scopeLabel}用不一樣的，直接在這裡加入一份即可——
          同一個角色的設定會覆蓋上層，不會兩份一起送給 AI。
        </Hint>
      )}
    </section>
  );
}

/** 角色選單（加入資料時選「這份資料在這裡扮演什麼」）。UI 文案永遠不是 DB 值。 */
export function contextRoleOptions(): Array<{ value: ContextRole; label: string }> {
  return CONTEXT_ROLES.map((role) => ({ value: role, label: CONTEXT_ROLE_LABEL[role] }));
}
