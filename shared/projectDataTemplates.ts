/**
 * 專案資料一鍵建表範本——不必先設計欄位。
 * 與 #133 plan 契約無關；只產出 DataField 定義＋建議表名與範例列。
 */
import { newFieldKey, type DataField, type DataRowData } from "./databaseFields";

export type ProjectDataTemplateId = "roster" | "quotes" | "checklist" | "blank";

export interface ProjectDataTemplate {
  id: ProjectDataTemplateId;
  /** 按鈕上的短名 */
  label: string;
  /** 建表預設名稱 */
  defaultName: string;
  /** 簡短說明 */
  hint: string;
  /** 不含專案連結欄（由 build 時自動附加） */
  buildFields: () => DataField[];
  /** 範例列（不含專案 id，由呼叫端填入 project 欄） */
  sampleRow: (projectFieldKey: string, projectId: string) => DataRowData;
}

/** 與 UI／既有「專案連結」語意一致，避免影視口吻 */
const PROJECT_FIELD_LABEL = "關聯專案";

/** 穩定 key 方便測試與匯出；避免 random 在 SSR 不一致——這裡只在 mutation 當下呼叫一次 */
function f(label: string, type: DataField["type"], extra?: Partial<DataField>): DataField {
  return { key: newFieldKey(), label, type, ...extra };
}

export const PROJECT_DATA_TEMPLATES: ProjectDataTemplate[] = [
  {
    id: "roster",
    label: "人員名單",
    defaultName: "人員名單",
    hint: "姓名與分工——適合協作與分工紀錄",
    buildFields: () => [
      f("姓名", "text", { required: true }),
      f("角色／分工", "text"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({
      [pk]: projectId,
    }),
  },
  {
    id: "quotes",
    label: "摘錄／重點",
    defaultName: "摘錄與重點",
    hint: "重點句、參考摘錄——供 AI 引用",
    buildFields: () => [
      f("內容", "text", { required: true }),
      f("來源", "text"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "checklist",
    label: "待辦清單",
    defaultName: "待辦清單",
    hint: "事項、確認項目——可勾完成",
    buildFields: () => [
      f("項目", "text", { required: true }),
      f("完成", "checkbox"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "blank",
    label: "空白資料表",
    defaultName: "專案資料表",
    hint: "僅名稱並關聯本專案，之後再加欄",
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
    // 填第一個必填文字欄一個範例，讓使用者立刻看到「已關聯本專案」
    const firstText = contentFields.find((c) => c.type === "text" && c.required);
    if (firstText) {
      if (templateId === "roster") data[firstText.key] = "（範例）請改成實際姓名";
      else if (templateId === "quotes") data[firstText.key] = "（範例）貼上要給 AI 引用的重點或摘錄";
      else if (templateId === "checklist") data[firstText.key] = "（範例）確認第一個待辦";
      else data[firstText.key] = "（範例）第一筆資料";
    }
    const check = contentFields.find((c) => c.type === "checkbox");
    if (check) data[check.key] = false;
    return data;
  };

  return { fields, projectFieldKey, sampleData };
}

/** 狀態文案：本專案是否已有 AI 可引用的資料 */
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
      label: "AI 已可引用本專案部分資料",
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
      detail: "圖檔已上傳；建議再貼說明文字、名單，或建立專案資料表，AI 會更準。",
    };
  }
  return {
    tone: "empty",
    label: "本專案還沒有可給 AI 的依據",
    detail: "先貼文字、上傳檔案，或一鍵建立資料表，再請 AI 協助。",
  };
}
