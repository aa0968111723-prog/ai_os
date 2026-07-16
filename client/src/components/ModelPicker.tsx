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
  bestFor: string;
  cost: string;
  verified: boolean;
  recommended: boolean;
  /** 此模型的 payload 是否用到提示詞（丟圖即得類=false，提示詞欄選填） */
  promptUsed: boolean;
}

/** 兩層模型挑選器:類別 → 模型(旗艦/經濟/最低成本分組)＋關鍵字過濾＋模型環境資訊卡 */
export function ModelPicker({
  onChange,
}: {
  onChange: (model: PickedModel | null) => void;
}) {
  const categories = trpc.models.categories.useQuery();
  const [category, setCategory] = useState("text-to-image");
  const models = trpc.models.byCategory.useQuery({ category });
  const [modelId, setModelId] = useState("");
  // 目錄擴到 270+ 後單類別可達 40+ 檔——類別內關鍵字過濾（比對名稱/特性/擅長），已選模型永遠保留
  const [q, setQ] = useState("");

  const all = useMemo(() => (models.data ?? []) as PickedModel[] & typeof models.data, [models.data]);
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return all;
    return all.filter(
      (m) => m.id === modelId || [m.label, m.strengths, m.bestFor, m.id].some((s) => s.toLowerCase().includes(kw)),
    );
  }, [all, q, modelId]);
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
    { label: "旗艦(最新最強)", tier: "flagship" },
    { label: "經濟(日常主力)", tier: "economy" },
    { label: "最低成本(試驗)", tier: "budget" },
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

      <label htmlFor="mp-search">模型(點數透明)</label>
      {all.length > 12 && (
        <input
          id="mp-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`在 ${all.length} 個${cat?.label ?? ""}模型中搜尋（例：中文、放大、去背）…`}
          aria-label="搜尋本類別模型"
          style={{ marginBottom: 6 }}
        />
      )}
      <select value={selected?.id ?? ""} disabled={loading} onChange={(e) => setModelId(e.target.value)}>
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
      {q.trim() && list.length === 0 && <p className="hint" style={{ marginTop: 4 }}>沒有符合「{q}」的模型——清空搜尋看全部。</p>}
      {loading && <p className="hint" style={{ marginTop: 4 }}>模型載入中…</p>}
      {loadError && (
        <p className="error">
          模型清單載入失敗：{loadError.message}
          <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => { categories.refetch(); models.refetch(); }}>
            重試
          </button>
        </p>
      )}
      {/* 模型環境資訊卡：選到哪個模型，環境說明就換成哪個——特性/擅長/計費/來源需求一目瞭然 */}
      {selected && (
        <div className="hint" style={{ marginTop: 6, lineHeight: 1.7 }}>
          <div>
            {selected.recommended && <span className="chip on" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 6 }}><Icon name="Star" size={12} /> 推薦</span>}
            {selected.strengths}
          </div>
          <div>適合：{selected.bestFor}</div>
          <div className="mono" style={{ fontSize: 12 }}>
            計費：{selected.cost}
            {selected.needs ? `｜需要來源：${selected.sourceHint ?? selected.needs}` : "｜打字即可生成，不需來源素材"}
          </div>
          {!selected.verified && <div style={{ color: "var(--gold-ink)" }}>⚠︎ 新收錄模型，正式模式首跑確認（失敗自動退點，不會白扣）</div>}
        </div>
      )}
    </div>
  );
}
