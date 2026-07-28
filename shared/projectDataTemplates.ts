/**
 * 專案資料一鍵建表範本——不必先設計欄位。
 * 面向剪輯／社群／動畫／外出等混合團隊：範本可當起點，欄位之後都能改。
 * 與 #133 plan 契約無關；只產出 DataField 定義＋建議表名與範例列。
 */
import { newFieldKey, type DataField, type DataRowData } from "./databaseFields";

/** 與 API z.enum 共用，避免前後端漂移 */
export const PROJECT_DATA_TEMPLATE_IDS = [
  "roster",
  "quotes",
  "media",
  "publish",
  "checklist",
  "blank",
] as const;

export type ProjectDataTemplateId = (typeof PROJECT_DATA_TEMPLATE_IDS)[number];

export interface ProjectDataTemplate {
  id: ProjectDataTemplateId;
  /** 按鈕上的短名 */
  label: string;
  /** 建表預設名稱 */
  defaultName: string;
  /** 簡短說明（多角色彈性用法） */
  hint: string;
  /** 不含專案連結欄（由 build 時自動附加） */
  buildFields: () => DataField[];
  /** 範例列（不含專案 id，由呼叫端填入 project 欄） */
  sampleRow: (projectFieldKey: string, projectId: string) => DataRowData;
}

/** 與 UI／FIELD_TYPES「專案連結」語意一致 */
const PROJECT_FIELD_LABEL = "關聯專案";

/** 穩定 key 方便測試與匯出；只在 mutation 當下呼叫一次 */
function f(label: string, type: DataField["type"], extra?: Partial<DataField>): DataField {
  return { key: newFieldKey(), label, type, ...extra };
}

/**
 * 範本清單：通用骨架，不綁死單一工作流。
 * 同一張表可給剪輯對素材、社群排發布、動畫追鏡頭、外出記人員。
 */
export const PROJECT_DATA_TEMPLATES: ProjectDataTemplate[] = [
  {
    id: "roster",
    label: "人員／分工",
    defaultName: "人員與分工",
    hint: "外出／棚內／遠端都可用：誰負責什麼、聯絡備註",
    buildFields: () => [
      f("姓名", "text", { required: true }),
      f("角色／分工", "text"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "quotes",
    label: "文案／重點",
    defaultName: "文案與重點",
    hint: "社群文案、旁白、標題句、參考摘錄——給人與 AI 引用",
    buildFields: () => [
      f("內容", "text", { required: true }),
      f("用途", "select", {
        options: ["社群", "旁白", "標題", "參考", "其他"],
      }),
      f("來源", "text"),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "media",
    label: "素材清單",
    defaultName: "素材清單",
    hint: "剪輯／動畫／外出素材：檔名或鏡號、類型、狀態",
    buildFields: () => [
      f("名稱", "text", { required: true }),
      f("類型", "select", {
        options: ["影片", "圖片", "音訊", "動畫", "其他"],
      }),
      f("狀態", "select", {
        options: ["待補", "已到", "採用", "不用"],
      }),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "publish",
    label: "發布計畫",
    defaultName: "發布計畫",
    hint: "社群小編／宣發：要發什麼、哪個渠道、預計日",
    buildFields: () => [
      f("標題", "text", { required: true }),
      f("渠道", "select", {
        options: ["IG", "FB", "YT", "Threads", "LINE", "其他"],
      }),
      f("預計日", "date"),
      f("狀態", "select", {
        options: ["草稿", "待審", "已排程", "已發布"],
      }),
      f("備註", "text"),
    ],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
  {
    id: "checklist",
    label: "待辦清單",
    defaultName: "待辦清單",
    hint: "行前確認、剪輯 QC、上架檢查——可勾完成",
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
    hint: "沒有合適範本時用這個：只關聯專案，欄位自己加",
    buildFields: () => [f("名稱", "text", { required: true })],
    sampleRow: (pk, projectId) => ({ [pk]: projectId }),
  },
];

const SAMPLE_FIRST_TEXT: Record<ProjectDataTemplateId, string> = {
  roster: "（範例）請改成實際姓名",
  quotes: "（範例）貼上要發布或給 AI 引用的句子",
  media: "（範例）素材名稱或檔名",
  publish: "（範例）這則要發的標題",
  checklist: "（範例）確認第一個待辦",
  blank: "（範例）第一筆資料",
};

export function getProjectDataTemplate(id: ProjectDataTemplateId): ProjectDataTemplate {
  const t = PROJECT_DATA_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`未知範本：${id}`);
  return t;
}

/**
 * 組出「範本欄位 + 專案連結欄」。
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
    const firstText = contentFields.find((c) => c.type === "text" && c.required);
    if (firstText) data[firstText.key] = SAMPLE_FIRST_TEXT[templateId];

    // 選填合理預設，讓新建表立刻可讀、不強制工作流
    for (const field of contentFields) {
      if (field.type === "checkbox") data[field.key] = false;
      if (field.type === "select" && field.options?.[0] && data[field.key] === undefined) {
        // 用途／類型／狀態取第一個選項當範例起點
        if (field.label === "用途") data[field.key] = "參考";
        else if (field.label === "類型") data[field.key] = "影片";
        else if (field.label === "渠道") data[field.key] = "IG";
        else if (field.label === "狀態" && templateId === "publish") data[field.key] = "草稿";
        else if (field.label === "狀態" && templateId === "media") data[field.key] = "待補";
        else data[field.key] = field.options[0];
      }
    }
    return data;
  };

  return { fields, projectFieldKey, sampleData };
}

/**
 * 狀態文案：本專案是否已有 AI 可引用的資料。
 * linkedAiReadableRowCount 必須只計 agentAccess≠none 的關聯列——避免「UI 說 ok、AI 其實不可見」。
 * linkedRowCount 可含全部關聯列（含 AI 不可見），僅作補充說明。
 */
export function projectDataAiHint(input: {
  knowledgeCount: number;
  assetCount: number;
  /** 全部已關聯列數（含 AI 不可見）；僅顯示用 */
  linkedRowCount: number;
  /**
   * AI 實際可讀的關聯列數（agentAccess read/write）。
   * 省略時退回 linkedRowCount（舊呼叫相容，但新 UI 應傳入）。
   */
  linkedAiReadableRowCount?: number;
}): { tone: "ok" | "partial" | "empty"; label: string; detail: string } {
  const { knowledgeCount, assetCount, linkedRowCount } = input;
  const aiRows = input.linkedAiReadableRowCount ?? linkedRowCount;
  const hasText = knowledgeCount > 0;
  const hasStruct = aiRows > 0;
  const hasMedia = assetCount > 0;
  const hiddenLinked = Math.max(0, linkedRowCount - aiRows);

  if (hasText || hasStruct) {
    return {
      tone: "ok",
      label: "AI 已可引用本專案部分資料",
      detail: [
        hasText ? `文字 ${knowledgeCount} 筆` : null,
        hasStruct ? `AI 可讀表列 ${aiRows}` : null,
        hasMedia ? `素材 ${assetCount} 件` : null,
        hiddenLinked > 0 ? `另有 ${hiddenLinked} 列 AI 不可見` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (linkedRowCount > 0 && !hasStruct) {
    return {
      tone: "partial",
      label: "有關聯表，但 AI 目前看不到",
      detail: "資料表已綁本專案，請把「AI 存取」改為可讀或可讀寫，AI 才會引用。",
    };
  }
  if (hasMedia) {
    return {
      tone: "partial",
      label: "有素材，但文字依據仍少",
      detail: "檔案已上傳；建議再補說明、文案或資料表，AI 會更準。",
    };
  }
  return {
    tone: "empty",
    label: "本專案還沒有可給 AI 的依據",
    detail: "先貼文字、上傳檔案，或一鍵建立資料表，再請 AI 協助。",
  };
}
