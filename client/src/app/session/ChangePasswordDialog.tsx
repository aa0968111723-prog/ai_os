import { useRef, useState } from "react";
import { trpc } from "../../api";
import { PasswordInput } from "../../components/PasswordInput";
import { Icon } from "../../components/Icon";
import { useFocusTrap } from "../../components/interactions";
import { Card, Hint, Meta } from "../../components/ui";

/**
 * 自助改密碼（拿到管理員的臨時密碼後，從這裡換成自己的）：成功後其他裝置全部登出。
 * forced：管理員重設密碼後的強制模式——不能取消、不能點背景關閉，
 * 成功後本地先清 mustChangePassword 解除強制對話框，再 invalidate 對齊伺服器。
 */
export function ChangePasswordDialog({ onClose, forced = false }: { onClose: () => void; forced?: boolean }) {
  const utils = trpc.useUtils();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const change = trpc.auth.changePassword.useMutation({
    // 先讓成功訊息停 1.8 秒再收尾——避免對話框在使用者讀到「已更新 ✓」前就消失
    onSuccess: () =>
      setTimeout(() => {
        // 改密碼已成功，先本地清旗標：解除不能只靠 invalidate 的 refetch——它一失敗，強制對話框就永遠關不掉
        utils.auth.me.setData(undefined, (old) => (old ? { ...old, user: { ...old.user, mustChangePassword: false } } : old));
        utils.auth.me.invalidate();
        onClose();
      }, 1800),
  });
  const canSubmit = oldPw.length > 0 && newPw.length >= 8 && !change.isPending && !change.isSuccess;
  const dialogRef = useRef<HTMLDivElement>(null);
  // 真模態：焦點鎖在對話框內＋鎖背景捲動＋Esc 關閉（強制模式不可關）；關閉後焦點還給開啟者
  useFocusTrap(dialogRef, true, forced ? undefined : onClose);
  return (
    <div
      className="modal-scrim"
      onClick={(e) => { if (!forced && e.target === e.currentTarget) onClose(); }}
    >
      <Card className="modal-card" ref={dialogRef} role="dialog" aria-modal="true" aria-label="改密碼">
        <h2 style={{ marginTop: 0 }}>改密碼</h2>
        {forced && <Hint layer="always">管理員重設了你的密碼——請先設定一組自己的新密碼再繼續使用</Hint>}
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) change.mutate({ oldPassword: oldPw, newPassword: newPw }); }}>
          <label htmlFor="chpw-old">原密碼（或管理員給的臨時密碼）</label>
          <PasswordInput id="chpw-old" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" autoFocus />
          <label htmlFor="chpw-new">新密碼（至少 8 碼）</label>
          <PasswordInput id="chpw-new" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          {newPw.length > 0 && newPw.length < 8 && <Hint layer="always">還差 {8 - newPw.length} 個字</Hint>}
          <div style={{ marginTop: "var(--sp-16)", display: "flex", gap: "var(--sp-8)" }}>
            <button className="primary" type="submit" disabled={!canSubmit}>{change.isPending ? "更新中…" : "更新密碼"}</button>
            {!forced && <button type="button" onClick={onClose}>取消</button>}
          </div>
        </form>
        {change.error && <p className="error" role="alert">{change.error.message}</p>}
        {change.isSuccess && <Meta as="p" style={{ color: "var(--success-ink)" }} role="status"><Icon name="Check" size={14} style={{ verticalAlign: "-2px" }} /> 已更新——其他裝置已登出，本裝置不受影響</Meta>}
      </Card>
    </div>
  );
}
