import { useRef, useState } from "react";
import { trpc } from "../api";
import { BRAND_NAME } from "../brand";
import { BrandLogo } from "../components/BrandLogo";
import { BrandReveal } from "../components/BrandReveal";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { PasswordInput } from "../components/PasswordInput";
import { Icon } from "../components/Icon";

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
  const nameRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"register" | "login">("register");
  const login = trpc.auth.login.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: () => {
      pwRef.current?.select();
      pwRef.current?.focus();
    },
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: () => {
      pwRef.current?.select();
      pwRef.current?.focus();
    },
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const isBusy = login.isPending || register.isPending;

  const clearStaleError = () => {
    if (login.error) login.reset();
    if (register.error) register.reset();
    if (localError) setLocalError("");
  };

  const doLogin = () => {
    if (isBusy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setLocalError("Email 格式不對，請檢查（例：you@example.com）");
      return;
    }
    setLocalError("");
    login.mutate({ email: email.trim(), password });
  };

  const doRegister = () => {
    if (isBusy) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setLocalError("請輸入姓名");
      nameRef.current?.focus();
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setLocalError("Email 格式不對，請檢查（例：you@example.com）");
      return;
    }
    if (password.length < 8) {
      setLocalError("密碼至少 8 碼");
      pwRef.current?.focus();
      return;
    }
    setLocalError("");
    register.mutate({ name: cleanName, email: email.trim(), password });
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
      <div className="card login-card">
        <BrandReveal mode="fade-rise" onceKey="login" durationMs={720}>
          <div className="login-brand">
            <BrandLogo variant="full" size="hero" showTagline priority />
          </div>
          {/* 可讀標題由 BrandLogo 的 aria-label 提供；表單前保留視覺層級用的隱藏 h1 */}
          <h1 className="sr-only">{BRAND_NAME}</h1>
        </BrandReveal>
        {/* 用 <form>：瀏覽器/密碼管理器靠它辨識登入表單做自動填入；Enter 由 submit 統一處理 */}
        <form style={{ textAlign: "left" }} onSubmit={(e) => { e.preventDefault(); mode === "register" ? doRegister() : doLogin(); }}>
          {mode === "register" ? (
            <>
              <label htmlFor="reg-name">姓名</label>
              <input
                id="reg-name"
                ref={nameRef}
                value={name}
                onChange={(e) => { setName(e.target.value); clearStaleError(); }}
                placeholder="你的名字"
                autoComplete="name"
                autoFocus
              />
            </>
          ) : null}
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearStaleError(); }}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus={mode === "login"}
          />
          <label htmlFor="login-pw">密碼</label>
          <PasswordInput
            id="login-pw"
            ref={pwRef}
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearStaleError(); }}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
          <div style={{ marginTop: "var(--sp-16)" }}>
            <button
              className="primary"
              type="submit"
              style={{ width: "100%" }}
              disabled={isBusy || (mode === "login" && (!email.trim() || !password))}
            >
              {isBusy ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-8)" }}>
                  <Icon name="Loader" className="spin" />
                  {mode === "register" ? "建立中…" : "登入中…"}
                </span>
              ) : (
                mode === "register" ? "建立帳號" : "登入"
              )}
            </button>
          </div>
        </form>
        {localError ? (
          <p className="error" role="alert">{localError}</p>
        ) : register.error ? (
          <p className="error" role="alert">{friendlyAuthError(register.error.message)}</p>
        ) : login.error ? (
          <p className="error" role="alert">{friendlyAuthError(login.error.message)}</p>
        ) : null}
        <button
          type="button"
          className="btn"
          style={{ width: "100%", marginTop: "var(--sp-12)" }}
          onClick={() => {
            setMode(mode === "register" ? "login" : "register");
            setLocalError("");
            login.reset();
            register.reset();
          }}
        >
          {mode === "register" ? "已有帳號？登入" : "還沒有帳號？註冊"}
        </button>
        <p className="hint" style={{ marginTop: "var(--sp-12)" }}>
          {mode === "register" ? "註冊後會有自己的工作區，可以直接開始。" : "忘記密碼請找管理員重設。"}
        </p>
        <div style={{ marginTop: "var(--sp-16)", textAlign: "left" }}>
          <InstallAppBanner />
        </div>
      </div>
    </div>
  );
}
