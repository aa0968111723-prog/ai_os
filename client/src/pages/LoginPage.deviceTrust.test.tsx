/**
 * 陌生裝置登入流程的前端契約測試。
 *
 * 覆蓋這條路最容易壞掉的地方：登入回傳改成判別聯集後，
 * 「密碼對但裝置陌生」不能被當成登入成功——那會讓使用者看到空白的已登入畫面，
 * 而後端其實沒發 session。
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loginMutate = vi.fn();
const verifyMutate = vi.fn();
const meInvalidate = vi.fn();
/** 由測試設定：login 成功時要回傳的內容 */
let loginResult: unknown = { status: "ok", auth: null };

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: meInvalidate } } }),
    auth: {
      login: {
        useMutation: (opts?: { onSuccess?: (r: unknown) => void }) => ({
          mutate: (vars: unknown) => {
            loginMutate(vars);
            opts?.onSuccess?.(loginResult);
          },
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      verifyDevice: {
        useMutation: (opts?: { onSuccess?: (r: unknown) => void }) => ({
          mutate: (vars: unknown) => {
            verifyMutate(vars);
            opts?.onSuccess?.({ status: "ok", auth: null });
          },
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

import { LoginPage } from "./LoginPage";

const CHALLENGE = {
  status: "device_verification_required",
  challengeId: "11111111-1111-4111-8111-111111111111",
  emailMasked: "a***e@example.com",
  deviceLabel: "iPhone · Safari",
};

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "alice@example.com");
  await user.type(screen.getByLabelText("密碼"), "pw-correct-123");
  await user.click(screen.getByRole("button", { name: "登入" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  loginResult = { status: "ok", auth: null };
});

describe("已信任裝置", () => {
  it("直接登入，不出現驗證碼畫面", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    await waitFor(() => expect(meInvalidate).toHaveBeenCalled());
    expect(screen.queryByLabelText("驗證碼")).not.toBeInTheDocument();
  });

  it("送出時附帶裝置特徵供伺服器辨識", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    expect(loginMutate).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alice@example.com", device: expect.any(Object) }),
    );
  });
});

describe("陌生裝置", () => {
  beforeEach(() => {
    loginResult = CHALLENGE;
  });

  // 這是最重要的一條：後端刻意沒發 session，前端若當成成功就會顯示空白的已登入畫面
  it("不視為登入成功，改顯示驗證碼畫面", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    expect(await screen.findByLabelText("驗證碼")).toBeInTheDocument();
    expect(meInvalidate).not.toHaveBeenCalled();
  });

  it("告訴使用者信寄到哪、是哪台裝置", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    expect(await screen.findByText("a***e@example.com")).toBeInTheDocument();
    expect(screen.getByText(/iPhone · Safari/)).toBeInTheDocument();
  });

  // challengeId 只是票根不是身分證明，故兌換時必須連帳密一起送回後端重驗
  it("驗證時連同帳號密碼一起送回，票根不單獨換 session", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    await user.type(await screen.findByLabelText("驗證碼"), "483920");
    await waitFor(() => expect(verifyMutate).toHaveBeenCalled());
    expect(verifyMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        password: "pw-correct-123",
        challengeId: CHALLENGE.challengeId,
        code: "483920",
      }),
    );
  });

  it("輸滿 6 碼自動送出，不必再按一次按鈕", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    await user.type(await screen.findByLabelText("驗證碼"), "483920");
    await waitFor(() => expect(verifyMutate).toHaveBeenCalledTimes(1));
  });

  // 使用者常直接從信件複製整串，可能帶空白或其他字元
  it("貼上帶雜訊的驗證碼會濾成純數字", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    const input = await screen.findByLabelText("驗證碼");
    await user.click(input);
    await user.paste("483 920");
    await waitFor(() => expect(verifyMutate).toHaveBeenCalled());
    expect(verifyMutate).toHaveBeenCalledWith(expect.objectContaining({ code: "483920" }));
  });

  it("驗證成功後才刷新登入狀態", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    await user.type(await screen.findByLabelText("驗證碼"), "483920");
    await waitFor(() => expect(meInvalidate).toHaveBeenCalled());
  });

  it("可以取消回到登入頁重來", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "取消，回到登入" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("驗證碼")).not.toBeInTheDocument();
  });

  // 非本人觸發時，使用者必須當場知道密碼已外洩、要去改密碼
  it("提示不是本人時該怎麼辦", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await signIn(user);
    expect(await screen.findByText(/改密碼/)).toBeInTheDocument();
  });
});
