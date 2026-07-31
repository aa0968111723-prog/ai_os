import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Card, Chip, Hint, Meta } from "./ui";
import {
  buildEpisodeTitle,
  episodeVariablesSchema,
  listSeriesTemplates,
  masterTitle,
  type EpisodeVariableKey,
  type EpisodeVariables,
} from "@shared/seriesTemplate";

/**
 * 母版系列面板（#255 第 1 期）：把 SOP 的「複製 → 填 4 格 → 依 5 段生成 → 排分鏡 → 送審」
 * 收成一個入口——組員不必自己在專案清單裡認名字、也不會手抄錯規格。
 *
 * 分工照 SOP §5：建母版（全系列骨架）＝組長；開一集＝任何組員。
 */

/** 只放一條系列時不必給選擇器；之後多條再加下拉 */
const template = listSeriesTemplates()[0];

const EMPTY: Record<EpisodeVariableKey, string> = {
  topic: "",
  sourceQuote: "",
  taboo: "",
  dueDate: "",
};

export function SeriesTemplatePanel({ groupId, isLeader }: { groupId: string; isLeader: boolean }) {
  const utils = trpc.useUtils();
  const overview = trpc.projects.seriesOverview.useQuery(
    { groupId, templateId: template.id },
    { enabled: !!groupId },
  );
  const [vars, setVars] = useState<Record<EpisodeVariableKey, string>>(EMPTY);
  const [openForm, setOpenForm] = useState(false);

  const invalidate = () => {
    utils.projects.seriesOverview.invalidate({ groupId, templateId: template.id });
    utils.projects.list.invalidate();
  };
  const createMaster = trpc.projects.createSeriesMaster.useMutation({ onSuccess: invalidate });
  const createEpisode = trpc.projects.createSeriesEpisode.useMutation({
    onSuccess: () => {
      invalidate();
      setVars(EMPTY);
      setOpenForm(false);
    },
  });

  const parsed = episodeVariablesSchema.safeParse(vars);
  // 只在「使用者已經開始填」時顯示第一則錯誤——一開啟就滿江紅是勸退，不是引導
  const touched = Object.values(vars).some((v) => v.trim());
  const firstError = parsed.success ? null : parsed.error.issues[0]?.message ?? null;
  const master = overview.data?.master ?? null;
  const episodes = overview.data?.episodes ?? [];
  const previewTitle = parsed.success ? buildEpisodeTitle(template, parsed.data as EpisodeVariables) : null;

  return (
    <Card as="section" aria-label="母版系列" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name="Clapperboard" size={16} />
        <strong>母版系列 · {template.seriesName}</strong>
        <Chip>{template.totalSec} 秒 · {template.aspect}</Chip>
        {!!episodes.length && <Chip>已開 {episodes.length} 集</Chip>}
      </div>
      <Meta as="p" style={{ marginTop: 4 }}>
        {template.purpose}固定骨架不動，每集只填 4 格。
      </Meta>

      {overview.isLoading && <Hint layer="always">載入中…</Hint>}

      {/* 還沒有母版：先建骨架（組長），組員只會看到「請組長先建立」 */}
      {!overview.isLoading && !master && (
        <div style={{ marginTop: 10 }}>
          {isLeader ? (
            <>
              <Button
                disabled={createMaster.isPending}
                onClick={() => createMaster.mutate({ groupId, templateId: template.id })}
              >
                {createMaster.isPending ? "建立中…" : `建立母版「${masterTitle(template)}」`}
              </Button>
              <Hint layer="always" style={{ marginTop: 6 }}>
                只做一次：會建一個寫死規格的母版專案（規格筆記＋5 段分鏡空殼），不花點數。
              </Hint>
            </>
          ) : (
            <Hint layer="always">這個組還沒有「{masterTitle(template)}」——請組長先建立母版，才能開每一集。</Hint>
          )}
          {createMaster.error && <p className="error" role="alert">{createMaster.error.message}</p>}
        </div>
      )}

      {/* 已有母版：開一集 */}
      {master && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant={openForm ? "ghost" : "primary"} size="sm" onClick={() => setOpenForm((v) => !v)}>
              <Icon name={openForm ? "X" : "Plus"} size={14} />
              {openForm ? "收起" : "開新的一集"}
            </Button>
            <Link href={`/p/${master.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="FileText" size={14} />看母版規格
            </Link>
          </div>

          {openForm && (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {template.variables.map((v) => (
                <div key={v.key}>
                  <label htmlFor={`sv-${v.key}`} style={{ marginTop: 0 }}>{v.label}</label>
                  {v.key === "dueDate" ? (
                    <input
                      id={`sv-${v.key}`}
                      type="date"
                      value={vars.dueDate}
                      onChange={(e) => setVars((p) => ({ ...p, dueDate: e.target.value }))}
                    />
                  ) : (
                    <input
                      id={`sv-${v.key}`}
                      value={vars[v.key]}
                      placeholder={v.hint}
                      onChange={(e) => setVars((p) => ({ ...p, [v.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              <Hint layer="always">
                其餘（{template.totalSec} 秒、{template.aspect}、5 段結構、禁忌與交付）全部跟母版，不要自己改。
                沒有原句或禁忌請明寫「無」。
              </Hint>
              {previewTitle && <Meta as="p">專案會叫：{previewTitle}</Meta>}
              {touched && firstError && <p className="error" role="alert">{firstError}</p>}
              <div>
                <Button
                  variant="primary"
                  disabled={!parsed.success || createEpisode.isPending}
                  onClick={() => {
                    if (!parsed.success) return;
                    createEpisode.mutate({ groupId, templateId: template.id, variables: parsed.data });
                  }}
                >
                  {createEpisode.isPending ? "開集中…" : "開這一集"}
                </Button>
              </div>
              {createEpisode.error && <p className="error" role="alert">{createEpisode.error.message}</p>}
            </div>
          )}

          {!!episodes.length && (
            <div style={{ marginTop: 10 }}>
              <Meta as="p">最近幾集</Meta>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {episodes.slice(0, 6).map((ep) => (
                  <Link key={ep.id} href={`/p/${ep.id}`} className="chip" title={ep.title}>
                    {ep.dueDate}｜{ep.topic}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {overview.error && <p className="error" role="alert">母版狀態載入不了：{overview.error.message}</p>}
    </Card>
  );
}
