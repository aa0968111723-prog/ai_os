import { useEffect, useMemo, useState } from "react";
import { trpc } from "../api";
import { MODELS } from "@shared/models";
import { Icon } from "./Icon";
import { Button, Chip, Hint, Meta } from "./ui";
export interface PickedModel {
  id: string;
  label: string;
  points: number;
  needs: string | null;
  sourceHint: string | null;
  kind: string;
  tierLabel: string;
  strengths: string;
  verified: boolean;
  recommended: boolean;
}

export function pickDefaultModel(list: PickedModel[]): PickedModel | undefined {
  return (
    list.find((model) => model.verified && model.recommended) ??
    list.find((model) => model.verified) ??
    list.find((model) => model.recommended) ??
    list[0]
  );
}

/** 兩層模型挑選器:類別 → 模型(旗艦/經濟/最低成本分組)。
 *  pickRequest：外部指定模型（提示詞庫「再用」/生成紀錄「再用此設定」還原完整設定用）——
 *  nonce 遞增才套用一次，之後使用者仍可自由改選，不會被外部值鎖死 */
export function ModelPicker({
  onChange,
  pickRequest,
}: {
  onChange: (model: PickedModel | null) => void;
  pickRequest?: { modelId: string; nonce: number } | null;
}) {
  const categories = trpc.models.categories.useQuery();
  const [category, setCategory] = useState("text-to-image");
  const models = trpc.models.byCategory.useQuery({ category });
  const [modelId, setModelId] = useState("");
  const staticRequestedModel = pickRequest
    ? MODELS.find((model) => model.id === pickRequest.modelId)
    : undefined;
  const requestedModel = trpc.models.get.useQuery(
    { id: pickRequest?.modelId ?? "__no_model_requested__" },
    { enabled: Boolean(pickRequest?.modelId && !staticRequestedModel) },
  );

  // 外部指定模型：靜態目錄可立即切換；即時同步發現的新模型則由伺服器目錄補解析。
  // 下架／未知模型仍不套用，避免還原設定時默默換成另一個模型。
  useEffect(() => {
    if (!pickRequest) return;
    const m = staticRequestedModel ?? requestedModel.data;
    if (!m || m.category === "workflow") return;
    setCategory(m.category);
    setModelId(m.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickRequest?.nonce, requestedModel.data?.id]);

  const list = useMemo(() => (models.data ?? []) as PickedModel[] & typeof models.data, [models.data]);
  // 預設順序：已驗證推薦 → 任一已驗證 → 待驗證推薦 → 清單第一項。
  // 使用者手動指定仍予以尊重，不會因政策排序覆蓋。
  const recommendedDefault = pickDefaultModel(list as PickedModel[]);
  const selected = (list.find((m) => m.id === modelId) ?? recommendedDefault) as PickedModel | undefined;

  useEffect(() => {
    onChange(selected ?? null);
    if (selected && selected.id !== modelId) setModelId(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const groups: Array<{ label: string; tier: string }> = [
    { label: "旗艦(最新最強)", tier: "flagship" },
    { label: "經濟(日常主力)", tier: "economy" },
    { label: "最低成本(試驗)", tier: "budget" },
  ];
  const cat = categories.data?.find((c) => c.id === category);
  const loading = categories.isLoading || models.isLoading;
  const loadError = categories.error ?? models.error;

  return (
    <div data-fb="模型挑選">
      <label htmlFor="mp-category">創作類別</label>
      <select id="mp-category" value={category} disabled={categories.isLoading} onChange={(e) => { setCategory(e.target.value); setModelId(""); }}>
        {(categories.data ?? []).filter((c) => c.id !== "workflow").map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      {cat && <Hint style={{ marginTop: 4 }}>{cat.hint}</Hint>}

      <label htmlFor="mp-model">模型(點數透明)</label>
      <select id="mp-model" value={selected?.id ?? ""} disabled={loading} onChange={(e) => setModelId(e.target.value)}>
        {groups.map((g) => {
          const inTier = list.filter((m) => (m as unknown as { tier: string }).tier === g.tier);
          if (!inTier.length) return null;
          return (
            <optgroup key={g.tier} label={g.label}>
              {inTier.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.points} 點{m.recommended ? " 推薦" : ""}{m.verified ? "" : " 未驗證"}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {loading && <Meta as="p" style={{ marginTop: 4 }}>模型載入中…</Meta>}
      {loadError && (
        <p className="error">
          模型清單載入失敗：{loadError.message}
          <Button size="sm" style={{ marginLeft: 8 }} onClick={() => { categories.refetch(); models.refetch(); }}>
            重試
          </Button>
        </p>
      )}
      {selected && (
        <Meta as="p" style={{ marginTop: 4 }}>
          {selected.recommended && <Chip selected style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 6 }}><Icon name="Star" size={12} /> 推薦</Chip>}
          {selected.strengths}
          {!selected.verified && <span style={{ color: "var(--gold-ink)" }}>(<Icon name="TriangleAlert" size={12} style={{ verticalAlign: "-1px", margin: "0 2px" }} />新模型 ID 待正式模式首跑確認;失敗會自動退點)</span>}
        </Meta>
      )}
    </div>
  );
}
