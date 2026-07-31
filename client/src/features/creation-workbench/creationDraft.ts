import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared creation draft across workbench modes.
 * Persisted per projectId so mode switch / collapse does not clear inputs.
 */

export type CreationMode = "ask" | "generate" | "template" | "plan";

export interface CreationDraft {
  goal: string;
  mode: CreationMode;
  category?: string;
  modelId?: string;
  prompt?: string;
  sourceAssetIds: string[];
  characterIds: string[];
  scenePresetIds: string[];
  /** 問 AI／多步開拍：優先注入的知識庫篇目 id（≤20） */
  knowledgeIds: string[];
  worldviewEnabled: boolean;
  templateId?: string;
  /** Prompt library source id when draft was filled via apply_prompt (reuse tracking). */
  promptSourceId?: string;
  /**
   * ＋ 技能（模式／AI 職能 id）。只影響入口與目標提示，不扣點。
   * 見 shared/agentSkills.ts
   */
  skillIds?: string[];
}

export const CREATION_MODES: ReadonlyArray<{
  id: CreationMode;
  label: string;
  description: string;
}> = [
  { id: "ask", label: "一起想", description: "發想、拆分鏡、問專案" },
  { id: "generate", label: "直接出圖", description: "圖、影、聲音" },
  { id: "template", label: "套用範本", description: "固定套路一次串" },
  { id: "plan", label: "多步開拍", description: "排步驟、過目再開拍" },
] as const;

const STORAGE_PREFIX = "aios.creationDraft.";

export function emptyDraft(mode: CreationMode = "ask"): CreationDraft {
  return {
    goal: "",
    mode,
    sourceAssetIds: [],
    characterIds: [],
    scenePresetIds: [],
    knowledgeIds: [],
    worldviewEnabled: true,
    skillIds: [],
  };
}

function storageKey(projectId: string): string {
  return STORAGE_PREFIX + projectId;
}

function isMode(value: unknown): value is CreationMode {
  return value === "ask" || value === "generate" || value === "template" || value === "plan";
}

function normalizeDraft(raw: unknown, fallbackMode: CreationMode = "ask"): CreationDraft {
  const base = emptyDraft(fallbackMode);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    goal: typeof o.goal === "string" ? o.goal : base.goal,
    mode: isMode(o.mode) ? o.mode : base.mode,
    category: typeof o.category === "string" ? o.category : undefined,
    modelId: typeof o.modelId === "string" ? o.modelId : undefined,
    prompt: typeof o.prompt === "string" ? o.prompt : undefined,
    sourceAssetIds: Array.isArray(o.sourceAssetIds)
      ? o.sourceAssetIds.filter((x): x is string => typeof x === "string")
      : base.sourceAssetIds,
    characterIds: Array.isArray(o.characterIds)
      ? o.characterIds.filter((x): x is string => typeof x === "string")
      : base.characterIds,
    scenePresetIds: Array.isArray(o.scenePresetIds)
      ? o.scenePresetIds.filter((x): x is string => typeof x === "string")
      : base.scenePresetIds,
    knowledgeIds: Array.isArray(o.knowledgeIds)
      ? o.knowledgeIds.filter((x): x is string => typeof x === "string").slice(0, 20)
      : base.knowledgeIds,
    worldviewEnabled: typeof o.worldviewEnabled === "boolean" ? o.worldviewEnabled : base.worldviewEnabled,
    templateId: typeof o.templateId === "string" ? o.templateId : undefined,
    promptSourceId: typeof o.promptSourceId === "string" ? o.promptSourceId : undefined,
    skillIds: Array.isArray(o.skillIds)
      ? o.skillIds.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 12)
      : base.skillIds,
  };
}

/** Prefer sessionStorage (tab-scoped); fall back to localStorage. */
function readStorage(key: string): string | null {
  try {
    const fromSession = window.sessionStorage.getItem(key);
    if (fromSession != null) return fromSession;
  } catch {
    /* private mode */
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function removeStorage(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadDraft(projectId: string): CreationDraft {
  if (typeof window === "undefined") return emptyDraft();
  const raw = readStorage(storageKey(projectId));
  if (!raw) return emptyDraft();
  try {
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(projectId: string, draft: CreationDraft): void {
  if (typeof window === "undefined") return;
  try {
    writeStorage(storageKey(projectId), JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearDraft(projectId: string): void {
  if (typeof window === "undefined") return;
  removeStorage(storageKey(projectId));
}

export type DraftPatch = Partial<CreationDraft>;

export function updateDraft(projectId: string, patch: DraftPatch): CreationDraft {
  const next = { ...loadDraft(projectId), ...patch };
  // Arrays must replace, not merge partials incorrectly when patch omits them.
  if (patch.sourceAssetIds) next.sourceAssetIds = patch.sourceAssetIds;
  if (patch.characterIds) next.characterIds = patch.characterIds;
  if (patch.scenePresetIds) next.scenePresetIds = patch.scenePresetIds;
  saveDraft(projectId, next);
  return next;
}

const DEBOUNCE_MS = 300;

/**
 * React hook: load draft for projectId, persist on change.
 * Mode switch / collapse must not clear draft — callers only patch fields.
 */
export function useCreationDraft(projectId: string): {
  draft: CreationDraft;
  setDraft: (patch: DraftPatch) => void;
  replaceDraft: (next: CreationDraft) => void;
  resetDraft: () => void;
} {
  const [draft, setDraftState] = useState<CreationDraft>(() => loadDraft(projectId));
  const projectRef = useRef(projectId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<CreationDraft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const flush = useCallback((id: string, value: CreationDraft) => {
    pendingRef.current = null;
    saveDraft(id, value);
  }, []);

  const scheduleSave = useCallback(
    (id: string, value: CreationDraft) => {
      pendingRef.current = value;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current) flush(id, pendingRef.current);
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  // projectId change: flush previous, load next
  useEffect(() => {
    if (projectRef.current === projectId) return;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) flush(projectRef.current, pendingRef.current);
    projectRef.current = projectId;
    setDraftState(loadDraft(projectId));
  }, [projectId, flush]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingRef.current) flush(projectRef.current, pendingRef.current);
    };
  }, [flush]);

  const setDraft = useCallback(
    (patch: DraftPatch) => {
      setDraftState((prev) => {
        const next: CreationDraft = {
          ...prev,
          ...patch,
          sourceAssetIds: patch.sourceAssetIds ?? prev.sourceAssetIds,
          characterIds: patch.characterIds ?? prev.characterIds,
          scenePresetIds: patch.scenePresetIds ?? prev.scenePresetIds,
        };
        scheduleSave(projectRef.current, next);
        return next;
      });
    },
    [scheduleSave],
  );

  const replaceDraft = useCallback(
    (next: CreationDraft) => {
      setDraftState(next);
      scheduleSave(projectRef.current, next);
    },
    [scheduleSave],
  );

  const resetDraft = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    clearDraft(projectRef.current);
    setDraftState(emptyDraft());
  }, []);

  return { draft, setDraft, replaceDraft, resetDraft };
}
