import { useRef, useState } from "react";
import { trpc } from "../api";
import { BRAND_NAME } from "../brand";
import { BrandLogo } from "../components/BrandLogo";
import { BrandReveal } from "../components/BrandReveal";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { PasswordInput } from "../components/PasswordInput";
import { Icon } from "../components/Icon";
import { Card, Hint } from "../components/ui";
import { collectDeviceHint } from "../deviceHint";
import posthog from "../posthog";

/**
 * 後端服務層故障（502/503/閘道逾時）或網路中斷時，tRPC 客戶端回傳的是技術性字串
 * （非 tRPC 形狀的 HTTP 回應、TypeError "Failed to fetch"、"load failed"…），
 * 例如 2026-08-08 502 事件實測看到「按鈕按了沒反應／看不懂的英文錯誤」。
 * 這些不是使用者輸入的問題——登入頁要說人話並給重試指引，而不是丟一串技術字串。
 */
const SERVER_DOWN_PATTERNS = [
  /502|503|504|bad gateway|service unavailable|gateway timeout/i,
  /failed to fetch|fetch failed|network request failed|network error|networkerror|load failed/i,
  /unexpected token|not valid json|unexpected end of json/i,
];

export function isServerDownMessage(message: string): boolean {
  return SERVER_DOWN_PATTERNS.some((re) => re.test(message));
}

/** 伺服器暫時不可用的統一提示：講清楚「不是你的輸入錯」＋「稍後再試」＋「持續發生找管理員」。 */
export const SERVER_DOWN_MESSAGE = "無法連線到伺服器——網站可能正在維護或暫時故障。請稍後再試；若持續發生請通知管理員。";

/**
 * zod 驗證失敗時 tRPC 預設把整包 issues JSON 塞進 error.message（伺服器端 errorFormatter
 * 不在本次可改範圍）——這裡取第一則訊息轉成一句人話，讓「email 格式/密碼長度」看得懂。
 * 伺服器層故障／網路中斷的技術性訊息（502、fetch 失敗等）優先換成人話。
 */
export function friendlyAuthError(message: string): string {
  if (isServerDownMessage(message)) return SERVER_DOWN_MESSAGE;
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

/** 陌生裝置時，登入回傳的待驗證狀態（密碼已對，但還沒發 session） */
interface PendingDevice {
  challengeId: string;
  emailMasked: string;
  deviceLabel: string;
}

/** AppShell 閘門吃 sessionBoot.bootstrap（不是 auth.me）。登入成功後兩邊都要清。 */
function refreshSession(utils: ReturnType<typeof trpc.useUtils>) {
  void utils.sessionBoot.bootstrap.invalidate();
  void utils.auth.me.invalidate();
}

export function LoginPage() {
  const utils = trpc.useUtils();
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingDevice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const login = trpc.auth.login.useMutation({
    onSuccess: (res) => {
      setIsSubmitting(false);
      // 陌生裝置：後端刻意沒發 session，改導到驗證碼步驟
      if (res.status === "device_verification_required") {
        setPending({
          challengeId: res.challengeId,
          emailMasked: res.emailMasked,
          deviceLabel: res.deviceLabel,
        });
        return;
      }
      // 必須清 sessionBoot：否則 bootstrap 快取 me:null（staleTime 60s）讓閘門以為還沒登入
      posthog.capture("auth_login_succeeded");
      refreshSession(utils);
    },
    // 失敗後選取整段密碼並聚焦：使用者直接重打即可，不用先手動清空
    onError: () => {
      setIsSubmitting(false);
      pwRef.current?.select();
      pwRef.current?.focus();
    },
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const isBusy = login.isPending || isSubmitting;

  // 一開始改字就收掉舊錯誤，避免「正在改了紅字還掛著」
  const clearStaleError = () => {
    if (login.error) login.reset();
    if (localError) setLocalError("");
  };

  // 送出驗證：缺漏欄位即時跳出提示並聚焦，避免按鈕按了毫無反應
  const doLogin = async () => {
    if (isBusy) return;
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setLocalError("請輸入 Email");
      emailRef.current?.focus();
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setLocalError("Email 格式不對，請檢查（例：you@example.com）");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setLocalError("請輸入密碼");
      pwRef.current?.focus();
      return;
    }
    setLocalError("");
    setIsSubmitting(true);
    try {
      const device = await collectDeviceHint();
      login.mutate({ email: cleanEmail, password, device });
    } catch {
      login.mutate({ email: cleanEmail, password, device: undefined });
    }
  };

  if (pending) {
    return (
      <DeviceVerifyStep
        pending={pending}
        email={email.trim()}
        password={password}
        onCancel={() => {
          setPending(null);
          setPassword("");
          login.reset();
        }}
        onVerified={() => {
          posthog.capture("auth_login_succeeded");
          refreshSession(utils);
        }}
      />
    );
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
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
        {/* 用 <form>：瀏覽器/密碼管理器靠它辨識登入表單做自動填入；noValidate 由 JavaScript 提供友善錯誤提示 */}
        <form noValidate style={{ textAlign: "left" }} onSubmit={(e) => { e.preventDefault(); void doLogin(); }}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            ref={emailRef}
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
              disabled={isBusy}
            >
              {isBusy ? (
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
        <Hint style={{ marginTop: "var(--sp-12)" }}>帳號採邀請制——請向你的組長或管理員索取邀請連結。忘記密碼請找管理員重設。</Hint>
        <div style={{ marginTop: "var(--sp-16)", textAlign: "left" }}>
          <InstallAppBanner />
        </div>
      </Card>
    </main>
  );
}

/**
 * 陌生裝置的信箱驗證步驟。
 *
 * 這一步會把 email／密碼連同驗證碼一起送回後端重驗一次——challengeId 只是票根、不是身分證明，
 * 若只憑票根＋驗證碼就換 session，撿到票根的人（例如共用電腦的瀏覽器紀錄）配上偷看到的碼即可
 * 繞過密碼登入。故密碼留在記憶體、不落 storage，取消時一併清掉。
 */
function DeviceVerifyStep({
  pending,
  email,
  password,
  onCancel,
  onVerified,
}: {
  pending: PendingDevice;
  email: string;
  password: string;
  onCancel: () => void;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const verify = trpc.auth.verifyDevice.useMutation({ onSuccess: onVerified });

  const submit = async (value: string) => {
    if (verify.isPending || !/^\d{6}$/.test(value)) return;
    verify.mutate({
      email,
      password,
      challengeId: pending.challengeId,
      code: value,
      device: await collectDeviceHint(),
    });
  };

  // 只留數字並截到 6 碼：貼上「483920」或「483 920」都能用，輸滿自動送出免再按一次
  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (verify.error) verify.reset();
    if (digits.length === 6) void submit(digits);
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      style={{
        minHeight: "calc(100dvh - 112px)",
        display: "grid",
        placeItems: "center",
        padding: "max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))",
      }}
    >
      <Card className="login-card">
        <div className="login-brand">
          <BrandLogo variant="full" size="hero" showTagline priority />
        </div>
        <h1 className="sr-only">{BRAND_NAME}　新裝置驗證</h1>
        <div style={{ textAlign: "left" }}>
          <h2 style={{ fontSize: "var(--fs-18)", marginBottom: "var(--sp-8)" }}>這台裝置我們沒見過</h2>
          <p style={{ marginBottom: "var(--sp-16)" }}>
            為了確認是你本人，我們寄了一組 6 位數驗證碼到 <strong>{pending.emailMasked}</strong>。
            請收信後填在下面。
          </p>
          <Hint style={{ marginBottom: "var(--sp-16)" }}>
            這次登入的裝置：{pending.deviceLabel}
          </Hint>
          <form onSubmit={(e) => { e.preventDefault(); void submit(code); }}>
            <label htmlFor="device-code">驗證碼</label>
            <input
              id="device-code"
              value={code}
              onChange={(e) => onChange(e.target.value)}
              // inputMode + autoComplete 讓手機跳數字鍵盤，並支援 iOS/Android 從簡訊或信件自動填入
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 位數字"
              // 刻意不用 maxLength：它會在 onChange 之前先截斷原始輸入，
              // 使用者從信件貼上「483 920」會被截成「483 92」，濾掉空白只剩 5 碼而送不出去。
              // 長度由下方 onChange 先去掉非數字再 slice(0,6) 控制。
              autoFocus
              style={{ letterSpacing: "0.4em", fontSize: "var(--fs-20)", textAlign: "center" }}
            />
            <div style={{ marginTop: "var(--sp-16)", display: "grid", gap: "var(--sp-8)" }}>
              <button
                className="primary"
                type="submit"
                style={{ width: "100%" }}
                disabled={code.length !== 6 || verify.isPending}
              >
                {verify.isPending ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-8)" }}>
                    <Icon name="Loader" className="spin" />
                    驗證中…
                  </span>
                ) : (
                  "確認並登入"
                )}
              </button>
              <button type="button" onClick={onCancel} style={{ width: "100%" }}>
                取消，回到登入
              </button>
            </div>
          </form>
          {verify.error ? (
            <p className="error" role="alert">{friendlyAuthError(verify.error.message)}</p>
          ) : null}
          <Hint style={{ marginTop: "var(--sp-12)" }}>
            驗證碼 10 分鐘內有效。收不到信請先看垃圾郵件匣；還是沒有就找管理員。
            如果這次登入不是你本人，代表有人知道了你的密碼——請立刻改密碼並通知管理員。
          </Hint>
        </div>
      </Card>
    </main>
  );
}
