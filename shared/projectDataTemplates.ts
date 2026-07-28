/**
 * 專案「本片資料」一鍵建表範本——給團隊創作者，不需自己設計欄位。
 * 與 #133 plan 契約無關；只產出 DataField 定義＋建議表名與範例列。
 */
import { newFieldKey, type DataField, type DataRowData } from "./databaseFields";

export type ProjectDataTemplateId = "roster" | "quotes" | "checklist" | "blank";

export interface ProjectDataTemplate {
  id: ProjectDataTemplateId;
  /** 按鈕上的短名 */
  label: string;
  /** 建表預設名稱（會加上專案縮寫時由呼叫端決定） */
  defaultName: string;
  /** 創作者看得懂的一句話 */
  hint: string;
  /** 不含專案連結欄（由 build 時自動附加） */
  buildFields: () => DataField[];
  /** 範例列（不含專案 id，由呼叫端填入 project 欄） */
  sampleRow: (projectFieldKey: string, projectId: string) => DataRowData;
}

const PROJECT_FIELD_LABEL = "屬於哪支片";

/** 穩定 key 方便測試與匯出；避免 random 在 SSR 不一致——這裡只在 mutation 當下呼叫一次 */
function f(label: string, type: DataField["type"], extra?: Partial<DataField>): DataField {
  return { key: newFieldKey(), label, type, ...extra };
}

export const PROJECT_DATA_TEMPLATES: ProjectDataTemplate[] = [
  {
    id: "roster",
    label: "場次／人員名單",
    defaultName: "本片・場次名單",
    hint: "誰出場、什麼角色——適合活動與拍攝分工",
    buildFields: () => [
      f("姓名", "text", { required: true }),
      f("角色／分工", "text"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({
      [pk]: projectId,
      // sample keys filled after fields built — use labels via caller
    }),
  },
  {
    id: "quotes",
    label: "金句／摘錄",
    defaultName: "本片・金句摘錄",
    hint: "開示金句、腳本摘錄——給 AI 創作時引用",
    buildFields: () => [
      f("內容", "text", { required: true }),
      f("來源", "text"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "checklist",
    label: "物資／待辦",
    defaultName: "本片・物資待辦",
    hint: "器材、物資、行前確認——可勾完成",
    buildFields: () => [
      f("項目", "text", { required: true }),
      f("完成", "checkbox"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "blank",
    label: "空白本片表",
    defaultName: "本片・資料表",
    hint: "只有名稱＋綁本片，之後自己加欄",
    buildFields: () => [f("名稱", "text", { required: true })],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
];

export function getProjectDataTemplate(id: ProjectDataTemplateId): ProjectDataTemplate {
  const t = PROJECT_DATA_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`未知範本：${id}`);
  return t;
}

/**
 * 組出「範本欄位 + 專案連結欄」。
 * 專案連結欄 key 固定用 `project_ref` 前綴可讀（仍符合 key 規則）。
 */
export function buildBoundTableFields(templateId: ProjectDataTemplateId): {
  fields: DataField[];
  projectFieldKey: string;
  sampleData: (projectId: string) => DataRowData;
} {
  const t = getProjectDataTemplate(templateId);
  const contentFields = t.buildFields();
  const projectFieldKey = "proj_" + templateId.slice(0, 6);
  const projectField: DataField = {
    key: projectFieldKey,
    label: PROJECT_FIELD_LABEL,
    type: "project",
    required: true,
  };
  const fields = [...contentFields, projectField];

  const sampleData = (projectId: string): DataRowData => {
    const data: DataRowData = { [projectFieldKey]: projectId };
    // 填第一個必填文字欄一個友善範例，讓創作者立刻看到「已綁本片」
    const firstText = contentFields.find((c) => c.type === "text" && c.required);
    if (firstText) {
      if (templateId === "roster") data[firstText.key] = "（範例）請改成實際姓名";
      else if (templateId === "quotes") data[firstText.key] = "（範例）貼上要給 AI 引用的金句或摘錄";
      else if (templateId === "checklist") data[firstText.key] = "（範例）確認第一批物資";
      else data[firstText.key] = "（範例）第一筆資料";
    }
    const check = contentFields.find((c) => c.type === "checkbox");
    if (check) data[check.key] = false;
    return data;
  };

  return { fields, projectFieldKey, sampleData };
}

/** 創作者狀態文案：有沒有「AI 大概用得上的」本片資料 */
export function projectDataAiHint(input: {
  knowledgeCount: number;
  assetCount: number;
  linkedRowCount: number;
}): { tone: "ok" | "partial" | "empty"; label: string; detail: string } {
  const { knowledgeCount, assetCount, linkedRowCount } = input;
  const hasText = knowledgeCount > 0;
  const hasStruct = linkedRowCount > 0;
  const hasMedia = assetCount > 0;
  if (hasText || hasStruct) {
    return {
      tone: "ok",
      label: "AI 已可引用本片部分資料",
      detail: [
        hasText ? `文字 ${knowledgeCount} 筆` : null,
        hasStruct ? `資料表 ${linkedRowCount} 列` : null,
        hasMedia ? `素材 ${assetCount} 件` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (hasMedia) {
    return {
      tone: "partial",
      label: "有素材，但文字依據仍少",
      detail: "圖影已上傳；建議再貼腳本／名單或建立本片表，AI 創作會更準。",
    };
  }
  return {
    tone: "empty",
    label: "本片還沒有可給 AI 的依據",
    detail: "先貼文字、上傳檔案，或一鍵建立本片表，再請 AI 排計畫。",
  };
}
