import { useRef, useState } from "react";
import { trpc } from "../api";
import { BRAND_NAME } from "../brand";
import { BrandLogo } from "../components/BrandLogo";
import { BrandReveal } from "../components/BrandReveal";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { PasswordInput } from "../components/PasswordInput";
import { Icon } from "../components/Icon";
import { Card, Hint } from "../components/ui";

/**
 * zod 驗證失敗時 tRPC 預設把整包 issues JSON 塞進 error.message（伺服器端 errorFormatter
 * 不在本次可改範圍）——這裡取第一則訊息轉成一句人話，讓「email 格式/密碼長度」看得懂。
 */
export function friendlyAuthError(message: string): string {
  try {
    const issues = JSON.parse(message) as Array<{ message?: string }>;
    if (Array.isArray(issues) && issues[0]?.message) {
      const m = issues[0].message;
      if (/invalid email/i.test(m)) return "Email 格式不對，請檢查（例：you@example.com）";
      const min = /at least (\d+) character/i.exec(m);
      if (min) return `密碼長度至少 ${min[1]} 個字`;
      return m; // 後端多數欄位已附中文訊息（如「email 格式不對」），直接顯示
    }
  } catch {
    /* 非 zod JSON → 一般錯誤訊息（如「email 或密碼不正確」）原樣顯示 */
  }
  return message;
}

export function LoginPage() {
  const utils = trpc.useUtils();
  const pwRef = useRef<HTMLInputElement>(null);
  const login = trpc.auth.login.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    // 失敗後選取整段密碼並聚焦：使用者直接重打即可，不用先手動清空
    onError: () => {
      pwRef.current?.select();
      pwRef.current?.focus();
    },
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  // 一開始改字就收掉舊錯誤，避免「正在改了紅字還掛著」
  const clearStaleError = () => {
    if (login.error) login.reset();
    if (localError) setLocalError("");
  };

  // 送出前先在本地擋明顯的 email 格式錯誤：不必等後端 zod 回整包 JSON 錯誤
  const doLogin = () => {
    if (login.isPending) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setLocalError("Email 格式不對，請檢查（例：you@example.com）");
      return;
    }
    setLocalError("");
    login.mutate({ email: email.trim(), password });
  };

  return (
    <div
      style={{
        // LoginPage 位於 AppHeader 與 .app 底部 padding 之間；不能再佔完整 100dvh，否則頁面必然多出垂直捲軸。
        minHeight: "calc(100dvh - 112px)",
        display: "grid",
        placeItems: "center",
        padding: "max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))",
      }}
    >
      <Card className="login-card">
        <BrandReveal mode="fade-rise" onceKey="login" durationMs={720}>
          <div className="login-brand">
            <BrandLogo variant="full" size="hero" showTagline priority />
          </div>
          {/* 可讀標題由 BrandLogo 的 aria-label 提供；表單前保留視覺層級用的隱藏 h1 */}
          <h1 className="sr-only">{BRAND_NAME}</h1>
        </BrandReveal>
        {/* 用 <form>：瀏覽器/密碼管理器靠它辨識登入表單做自動填入；Enter 由 submit 統一處理 */}
        <form style={{ textAlign: "left" }} onSubmit={(e) => { e.preventDefault(); doLogin(); }}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearStaleError(); }}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
          <label htmlFor="login-pw">密碼</label>
          <PasswordInput
            id="login-pw"
            ref={pwRef}
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearStaleError(); }}
            autoComplete="current-password"
          />
          <div style={{ marginTop: "var(--sp-16)" }}>
            <button
              className="primary"
              type="submit"
              style={{ width: "100%" }}
              disabled={!email.trim() || !password || login.isPending}
            >
              {login.isPending ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-8)" }}>
                  <Icon name="Loader" className="spin" />
                  登入中…
                </span>
              ) : (
                "登入"
              )}
            </button>
          </div>
        </form>
        {localError ? (
          <p className="error" role="alert">{localError}</p>
        ) : login.error ? (
          <p className="error" role="alert">{friendlyAuthError(login.error.message)}</p>
        ) : null}
        {/* 登入頁沒有註冊／忘記密碼入口，這句就是唯一的出路——收起來會讓進不去的人卡死，故 always */}
        <Hint layer="always" style={{ marginTop: "var(--sp-12)" }}>帳號採邀請制——請向你的組長或管理員索取邀請連結。忘記密碼請找管理員重設。</Hint>
        <div style={{ marginTop: "var(--sp-16)", textAlign: "left" }}>
          <InstallAppBanner />
        </div>
      </Card>
    </div>
  );
}
