import { Route, Switch } from "wouter";
import { AcceptInvitePage } from "../pages/AcceptInvitePage";
import { LoginPage } from "../pages/LoginPage";
import { AppRoutes, UngroupedRoutes } from "./AppRoutes";

export type SessionMe = {
  user: { isSuperAdmin: boolean; mustChangePassword: boolean };
  groups: { groupId: string; role: string }[];
  adminTeamIds: string[];
} | null | undefined;

export type SessionGateProps = {
  me: SessionMe;
  meLoading: boolean;
  meError: boolean;
  onRetry: () => void;
  isAdmin: boolean;
  activeGroupId: string;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
};

/**
 * Session / auth branching for the catch-all app tree:
 * invite route → loading → error → unauthenticated (login) →
 * signed-in but ungrouped → fully authenticated routes.
 *
 * Forced password-change is handled as an overlay in AppShell (mustChangePassword),
 * not as a separate route branch.
 */
export function SessionGate({
  me,
  meLoading,
  meError,
  onRetry,
  isAdmin,
  activeGroupId,
  activeIsLeader,
  canSeeOrg,
}: SessionGateProps) {
  return (
    <Switch>
      <Route path="/invite/:token">{(params) => <AcceptInvitePage token={params.token} />}</Route>
      <Route>
        {meLoading ? (
          <p className="hint">載入中…</p>
        ) : meError ? (
          <p className="error">
            系統暫時連不上（不是你被登出）——請稍候重新整理，或按{" "}
            <button className="btn-sm" onClick={onRetry}>重試</button>
          </p>
        ) : !me ? (
          <LoginPage />
        ) : me.groups.length === 0 && !me.user.isSuperAdmin && !isAdmin ? (
          // 團隊管理員不擋（!isAdmin）：他本人就能去「團隊管理」建組，擋住反而是自相矛盾的死路。
          // /help 保持可達——等待被加入組的空檔正是最需要說明的時候
          <UngroupedRoutes />
        ) : (
          <AppRoutes
            activeGroupId={activeGroupId}
            isAdmin={isAdmin}
            activeIsLeader={activeIsLeader}
            canSeeOrg={canSeeOrg}
          />
        )}
      </Route>
    </Switch>
  );
}
