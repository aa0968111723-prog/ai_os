import { useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../Icon";
import { ConfirmButton } from "../interactions";
import { Badge, Button, Card, Hint, Meta } from "../ui";

/**
 * BYOK Phase 3：個人 fal.ai API 金鑰卡片。
 * 鏡像 NotionCard 的 password-token UX；金鑰永不回顯，只顯示末四碼與狀態。
 * 啟用 preferUserKey 後生成走個人額度、不扣平台點數（Phase 2 dual-billing）。
 */
export function PersonalAiKeyCard() {
  const utils = trpc.useUtils();
  const list = trpc.userAiKeys.list.useQuery();
  const fal = list.data?.find((k) => k.provider === "fal") ?? null;

  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setMut = trpc.userAiKeys.set.useMutation({
    onSuccess: () => {
      utils.userAiKeys.list.invalidate();
      setKey("");
      setEditing(false);
      setTestMsg(null);
    },
  });
  const removeMut = trpc.userAiKeys.remove.useMutation({
    onSuccess: () => {
      utils.userAiKeys.list.invalidate();
      setTestMsg(null);
    },
  });
  const preferMut = trpc.userAiKeys.setPrefer.useMutation({
    onSuccess: () => utils.userAiKeys.list.invalidate(),
  });
  const testMut = trpc.userAiKeys.test.useMutation({
    onSuccess: (r) => {
      setTestMsg(r.ok ? { ok: true, text: "連線成功——金鑰可用" } : { ok: false, text: r.message });
      if (!key.trim()) utils.userAiKeys.list.invalidate();
    },
    onError: (e) => setTestMsg({ ok: false, text: e.message }),
  });

  const statusLabel = (s: string | null | undefined) => {
    if (s === "active") return "可用";
    if (s === "error") return "失效";
    if (s === "unverified") return "未驗證";
    return s ?? "—";
  };

  return (
    <Card as="section" id="integration-ai-key" style={{ marginTop: 12 }} data-fb="資料來源-個人AI金鑰卡">
      <h2><Icon name="Sparkles" size={18} /> 個人 AI 金鑰（fal.ai）</h2>
      <Hint style={{ marginTop: 4 }}>
        貼上你自己的{" "}
        <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">fal.ai API Key</a>
        ，生成時可優先使用你的額度——<strong>不扣平台點數</strong>。
        關閉「優先使用」或移除金鑰後，自動回到平台 FAL_KEY + 正常扣點。
      </Hint>
      <Hint style={{ marginTop: 4 }}>
        金鑰加密存放、永不回顯；探活只用免費 models 列表，不會觸發付費生成。
      </Hint>

      {list.isLoading ? (
        <Meta as="p">載入中…</Meta>
      ) : list.error ? (
        <p className="error" role="alert">
          載入失敗：{list.error.message}{" "}
          <Button size="sm" onClick={() => list.refetch()}>重試</Button>
        </p>
      ) : fal && !editing ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          {fal.status === "error" ? (
            <Meta style={{ margin: 0, color: "var(--danger-ink, #a33)" }} title={fal.lastError ?? undefined}>
              金鑰已失效（末四碼 {fal.keyLast4}）——請重新設定
            </Meta>
          ) : (
            <Meta style={{ margin: 0 }}>
              <Icon name="Check" size={13} /> 已設定・末四碼 {fal.keyLast4}
              <Badge style={{ marginLeft: 6 }}>{statusLabel(fal.status)}</Badge>
              {fal.preferUserKey ? (
                <Badge style={{ marginLeft: 4 }} title="生成時使用個人金鑰、不扣平台點數">優先使用</Badge>
              ) : (
                <Badge style={{ marginLeft: 4 }} title="僅備用；預設仍走平台額度">備用</Badge>
              )}
            </Meta>
          )}
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={fal.preferUserKey}
              disabled={preferMut.isPending}
              onChange={(e) => preferMut.mutate({ provider: "fal", preferUserKey: e.target.checked })}
            />
            優先使用我的金鑰
          </label>
          <Button
            size="sm"
            disabled={testMut.isPending}
            onClick={() => {
              setTestMsg(null);
              testMut.mutate({ provider: "fal" });
            }}
          >
            {testMut.isPending ? "測試中…" : "測試連線"}
          </Button>
          <Button size="sm" onClick={() => { setEditing(true); setKey(""); setTestMsg(null); }}>
            更換金鑰
          </Button>
          <ConfirmButton
            onConfirm={() => removeMut.mutate({ provider: "fal" })}
            message="移除個人 fal.ai 金鑰？之後生成會改用平台額度並正常扣點。"
            triggerClassName="btn-sm"
            disabled={removeMut.isPending}
          >
            移除
          </ConfirmButton>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <input
            type="password"
            aria-label="fal.ai API Key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="貼上 fal.ai API Key"
            style={{ flex: "1 1 260px", maxWidth: 420 }}
            autoComplete="off"
          />
          <Button
            size="sm"
            disabled={!key.trim() || testMut.isPending}
            onClick={() => {
              setTestMsg(null);
              testMut.mutate({ provider: "fal", key: key.trim() });
            }}
          >
            {testMut.isPending ? "測試中…" : "先測試"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!key.trim() || setMut.isPending}
            onClick={() => setMut.mutate({ provider: "fal", key: key.trim() })}
          >
            {setMut.isPending ? "驗證並儲存中…" : "驗證並儲存"}
          </Button>
          {editing && (
            <Button size="sm" onClick={() => { setEditing(false); setKey(""); setTestMsg(null); }}>
              取消
            </Button>
          )}
        </div>
      )}

      {testMsg && (
        <p
          className="meta"
          role="status"
          style={{ margin: "6px 0 0", color: testMsg.ok ? "var(--success-ink)" : "var(--danger-ink, #a33)" }}
        >
          {testMsg.text}
        </p>
      )}
      {setMut.error && <p className="error" role="alert">{setMut.error.message}</p>}
      {removeMut.error && <p className="error" role="alert">{removeMut.error.message}</p>}
      {preferMut.error && <p className="error" role="alert">{preferMut.error.message}</p>}
      <Hint style={{ marginTop: 6 }}>
        <Icon name="Lock" size={12} /> 金鑰送出後即加密存放，不會再顯示——之後只看得到末四碼。
      </Hint>
    </Card>
  );
}
