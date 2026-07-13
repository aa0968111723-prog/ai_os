import { useEffect, useMemo, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";

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

/** 兩層模型挑選器:類別 → 模型(旗艦/經濟/最低成本分組) */
export function ModelPicker({
  onChange,
}: {
  onChange: (model: PickedModel | null) => void;
}) {
  const categories = trpc.models.categories.useQuery();
  const [category, setCategory] = useState("text-to-image");
  const models = trpc.models.byCategory.useQuery({ category });
  const [modelId, setModelId] = useState("");

  const list = useMemo(() => (models.data ?? []) as PickedModel[] & typeof models.data, [models.data]);
  // 預設選「本類別推薦」(已驗證的經濟日常主力);使用者手動選過(modelId 有值)則尊重其選擇,
  // 都沒有才退回清單第一項。切換類別時上層 onChange 會重算點數,不影響金流。
  const recommendedDefault = list.find((m) => m.recommended) ?? list[0];
  const selected = (list.find((m) => m.id === modelId) ?? recommendedDefault) as PickedModel | undefined;

  useEffect(() => {
    onChange(selected ?? null);
    if (selected && selected.id !== modelId) setModelId(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const groups: Array<{ label: string; tier: string }> = [
    { label: "🏆 旗艦(最新最強)", tier: "flagship" },
    { label: "⚖️ 經濟(日常主力)", tier: "economy" },
    { label: "💡 最低成本(試驗)", tier: "budget" },
  ];
  const cat = categories.data?.find((c) => c.id === category);
  const loading = categories.isLoading || models.isLoading;
  const loadError = categories.error ?? models.error;

  return (
    <div data-fb="模型挑選">
      <label>創作類別</label>
      <select value={category} disabled={categories.isLoading} onChange={(e) => { setCategory(e.target.value); setModelId(""); }}>
        {(categories.data ?? []).filter((c) => c.id !== "workflow").map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      {cat && <p className="hint" style={{ marginTop: 4 }}>{cat.hint}</p>}

      <label>模型(點數透明)</label>
      <select value={selected?.id ?? ""} disabled={loading} onChange={(e) => setModelId(e.target.value)}>
        {groups.map((g) => {
          const inTier = list.filter((m) => (m as unknown as { tier: string }).tier === g.tier);
          if (!inTier.length) return null;
          return (
            <optgroup key={g.tier} label={g.label}>
              {inTier.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.points} 點{m.recommended ? " ⭐ 推薦" : ""}{m.verified ? "" : " ⚠︎ 未驗證"}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {loading && <p className="hint" style={{ marginTop: 4 }}>模型載入中…</p>}
      {loadError && (
        <p className="error">
          模型清單載入失敗：{loadError.message}
          <button style={{ marginLeft: 8, padding: "2px 10px", fontSize: 12 }} onClick={() => { categories.refetch(); models.refetch(); }}>
            重試
          </button>
        </p>
      )}
      {selected && (
        <p className="hint" style={{ marginTop: 4 }}>
          {selected.recommended && <span className="chip on" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 6 }}><Icon name="Star" size={12} /> 推薦</span>}
          {selected.strengths}
          {!selected.verified && <span style={{ color: "var(--warning, #C08A2E)" }}>(⚠︎ 新模型 ID 待真實模式首跑確認;失敗會自動退點)</span>}
        </p>
      )}
    </div>
  );
}
