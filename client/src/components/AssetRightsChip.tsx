/**
 * Asset-card commercial status. Chip only; details on click.
 * Not a legal opinion — evidence and missing facts, in plain language.
 */
import { useState } from "react";
import { trpc } from "../api";
import { rightsChip, rightsDetailRows, type RightsProfile, type RightsStatus } from "@shared/commercialRights";
import { Button, Chip, Hint, Meta } from "./ui";

function symbolOf(status: RightsStatus): string {
  const chip = rightsChip(status);
  if (chip.symbol === "ok") return "✓";
  if (chip.symbol === "warn") return "⚠";
  if (chip.symbol === "no") return "✕";
  return "?";
}

export function AssetRightsChip({
  assetId,
  canEdit,
  profile,
}: {
  assetId: string;
  canEdit: boolean;
  profile: RightsProfile | null;
}) {
  const utils = trpc.useUtils();
  const submit = trpc.commercialRights.submitEvidence.useMutation({
    onSuccess: () => {
      void utils.commercialRights.project.invalidate();
    },
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!profile) {
    return <Meta as="span" style={{ fontSize: 11 }}>? 資訊不足</Meta>;
  }

  const chip = rightsChip(profile.rightsStatus);
  return (
    <div className="asset-rights">
      <Chip
        selected={open}
        onClick={() => setOpen((v) => !v)}
        title="查看這份素材目前有沒有足夠依據可以商用"
      >
        {symbolOf(profile.rightsStatus)} {chip.label}
      </Chip>
      {open && <AssetRightsPanel profile={profile} canEdit={canEdit} reason={reason} setReason={setReason} pending={submit.isPending} error={submit.error?.message} onSubmit={() => {
        if (reason.trim().length < 8) return;
        submit.mutate({
          assetId,
          kind: "owner_declaration",
          reason: reason.trim(),
          ownsOrLicensed: true,
        });
      }} />}
    </div>
  );
}

export function AssetRightsPanel({
  profile,
  canEdit,
  reason,
  setReason,
  pending,
  error,
  onSubmit,
}: {
  profile: RightsProfile;
  canEdit: boolean;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  error?: string;
  onSubmit: () => void;
}) {
  const rows = rightsDetailRows(profile);
  return (
    <div className="asset-rights__panel" style={{ marginTop: 6 }}>
      {rows.map((row) => (
        <Meta as="div" key={row.label} style={{ fontSize: 11 }}>
          {row.label}：{row.value}
        </Meta>
      ))}
      {profile.findings.filter((f) => f.severity !== "info").map((finding) => (
        <Hint key={finding.code} style={{ margin: "6px 0 0", fontSize: 12 }}>
          ⚠ {finding.summary}
        </Hint>
      ))}
      {profile.evidence.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 12, cursor: "pointer" }}>查看依據</summary>
          {profile.evidence.map((item) => (
            <Meta as="div" key={item.id} style={{ fontSize: 11, marginTop: 4 }}>
              {item.summary}
              {item.recordedAt ? ` · ${item.recordedAt.slice(0, 10)}` : ""}
            </Meta>
          ))}
        </details>
      )}
      <Meta as="div" style={{ fontSize: 11, marginTop: 6 }}>若不能用，請改選或更換素材</Meta>
      {canEdit && (
        <div style={{ marginTop: 8 }}>
          <Meta as="div" style={{ fontSize: 11, marginBottom: 4 }}>補充授權（需寫原因，不能只按忽略）</Meta>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            aria-label="補充授權原因"
            placeholder="例如：這是我拍的原圖，或客戶來信同意用於本專案"
            style={{ width: "100%", fontSize: 12 }}
          />
          <Button size="sm" disabled={pending || reason.trim().length < 8} onClick={onSubmit} style={{ marginTop: 4 }}>
            補充授權
          </Button>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function ProjectRightsReadiness({
  projectId,
}: {
  projectId: string;
}) {
  const data = trpc.commercialRights.project.useQuery({ projectId }, { staleTime: 30_000 });
  if (!data.data) return null;
  const { summary } = data.data;
  if (!summary.total) return null;
  return (
    <Hint role="status" style={{ margin: "8px 0" }}>
      商用準備度 · {summary.total} 份素材 · ✓ {summary.usable} 可使用
      {summary.counts.REVIEW_REQUIRED + summary.counts.UNKNOWN > 0 ? ` · ⚠ ${summary.counts.REVIEW_REQUIRED + summary.counts.UNKNOWN} 需要確認` : ""}
      {summary.counts.BLOCKED > 0 ? ` · ✕ ${summary.counts.BLOCKED} 不可交付` : ""}
    </Hint>
  );
}
