import { trpc } from "../api";

/**
 * 專案權限卡（需求 2.3）：預設組內全員可編輯；組長可把個別成員設為「檢視者」（唯讀）。
 * 組長/管理員固定是編輯者（不可降）——裁決與管理不能被自己鎖住。
 * 也顯示「專案負責人」（封存/還原的裁決點），組長以上可在此轉移交接。
 * 資料與可管理與否都由 projects.listMemberRoles 回傳（後端已依身分判斷），前端不自行推權限。
 */
export function ProjectMembersCard({ projectId, bare = false }: { projectId: string; bare?: boolean }) {
  const utils = trpc.useUtils();
  const roles = trpc.projects.listMemberRoles.useQuery({ projectId });
  const setRole = trpc.projects.setProjectRole.useMutation({
    onSuccess: () => utils.projects.listMemberRoles.invalidate({ projectId }),
  });
  const setOwner = trpc.projects.setOwner.useMutation({
    onSuccess: () => {
      utils.projects.listMemberRoles.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
    },
  });

  if (roles.error) return null; // 讀不到（極端情況）就整卡收起，不擋工作台
  const data = roles.data;

  return (
    // bare：外層已有收合容器（工作台的 details）自帶標題時，不再包 .card 也不重複大標
    <div className={bare ? undefined : "card"} data-fb="專案權限卡">
      {!bare && <h2>專案權限</h2>}
      <p className="hint" style={{ marginTop: 4 }}>
        預設組內全員可編輯；把成員設為「檢視者」後，他在此專案只能瀏覽、留言與下載，不能生成或修改。
      </p>
      {/* 專案負責人：組長以上可轉移（人員異動交接）；一般成員唯讀顯示 */}
      {data && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <span className="hint" style={{ margin: 0 }}>負責人</span>
          {data.canManage ? (
            <select
              aria-label="專案負責人"
              style={{ width: "auto" }}
              value={data.owner.userId}
              disabled={setOwner.isPending}
              onChange={(e) => setOwner.mutate({ projectId, userId: e.target.value })}
            >
              {/* 負責人可能已離組：補一個唯讀選項顯示現況，避免下拉顯示成別人 */}
              {!data.owner.inGroup && (
                <option value={data.owner.userId}>{data.owner.name ? `${data.owner.name}（已離組）` : "（已離開的成員）"}</option>
              )}
              {data.members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name}</option>
              ))}
            </select>
          ) : (
            <b style={{ fontSize: 13 }}>{data.owner.name ?? "（已離開的成員）"}</b>
          )}
          {setOwner.isPending && <span className="hint">轉移中…</span>}
          {setOwner.error && <span className="error" style={{ marginTop: 0 }}>{setOwner.error.message}</span>}
        </div>
      )}
      {!data ? (
        <div role="status" aria-label="成員載入中">
          <div className="skeleton" style={{ height: 32, marginTop: 8 }} />
          <div className="skeleton" style={{ height: 32, marginTop: 8 }} />
        </div>
      ) : data.members.length === 0 ? (
        // 防禦性空狀態（正常不會出現：有效成員至少含目前使用者）——留一句話總比整卡靜默空白好
        <p className="hint" style={{ marginTop: 8 }}>讀不到成員清單——請重新整理；若持續發生請回報管理員。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {data.members.map((m) => (
            <li key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 auto", minWidth: 120 }}>
                {m.name}
                {m.groupRole !== "member" && <span className="hint">・{m.groupRole === "leader" ? "組長" : "管理"}</span>}
              </span>
              {m.groupRole !== "member" ? (
                <span className="hint">固定編輯者</span>
              ) : data.canManage ? (
                <select
                  aria-label={`${m.name} 的專案權限`}
                  style={{ width: "auto" }}
                  value={m.projectRole}
                  disabled={setRole.isPending}
                  onChange={(e) => setRole.mutate({ projectId, userId: m.userId, role: e.target.value as "editor" | "viewer" })}
                >
                  <option value="editor">編輯者</option>
                  <option value="viewer">檢視者（唯讀）</option>
                </select>
              ) : (
                <span className="hint">{m.projectRole === "viewer" ? "檢視者（唯讀）" : "編輯者"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {setRole.error && <p className="error" role="alert">{setRole.error.message}</p>}
    </div>
  );
}
