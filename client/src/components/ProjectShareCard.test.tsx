import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMutate = vi.fn();
const revokeMutate = vi.fn();
const listQuery = vi.fn();
let createHandlers: { onSuccess?: (r: { id: string; url: string; expiresAt: Date | null }) => void } = {};

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({ share: { list: { invalidate: vi.fn() } } }),
    share: {
      list: { useQuery: (...a: unknown[]) => listQuery(...a) },
      create: {
        useMutation: (opts?: typeof createHandlers) => {
          createHandlers = opts ?? {};
          return { mutate: createMutate, isPending: false, error: null };
        },
      },
      revoke: { useMutation: () => ({ mutate: revokeMutate, isPending: false, error: null }) },
    },
  },
}));

import { ProjectShareCard } from "./ProjectShareCard";

const link = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "l1",
  label: "給攝影夥伴",
  createdBy: "u1",
  createdAt: new Date("2026-08-01"),
  expiresAt: new Date("2026-09-01"),
  revokedAt: null,
  lastViewedAt: null,
  viewCount: 0,
  ...over,
});

describe("ProjectShareCard（分享連結卡）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listQuery.mockReturnValue({ data: [] });
  });

  it("建立時把備註與有效期一起送出", async () => {
    const user = userEvent.setup();
    render(<ProjectShareCard projectId="p1" canEdit />);

    await user.type(screen.getByLabelText("這條連結給誰（備註）"), "給攝影夥伴");
    await user.selectOptions(screen.getByLabelText("連結有效期"), "0"); // 7 天
    await user.click(screen.getByRole("button", { name: "建立分享連結" }));

    expect(createMutate).toHaveBeenCalledWith({ projectId: "p1", label: "給攝影夥伴", expiresInDays: 7 });
  });

  it("選「不設期限」時不送 expiresInDays（後端才知道是永久）", async () => {
    const user = userEvent.setup();
    render(<ProjectShareCard projectId="p1" canEdit />);

    await user.selectOptions(screen.getByLabelText("連結有效期"), "3");
    await user.click(screen.getByRole("button", { name: "建立分享連結" }));

    expect(createMutate).toHaveBeenCalledWith({ projectId: "p1", label: undefined, expiresInDays: undefined });
  });

  it("建立成功後把完整網址顯示出來讓人複製——原文只有這一次機會", async () => {
    render(<ProjectShareCard projectId="p1" canEdit />);
    createHandlers.onSuccess?.({ id: "l1", url: "/s/" + "a".repeat(64), expiresAt: null });

    await waitFor(() => {
      const field = screen.getByLabelText("分享連結") as HTMLInputElement;
      expect(field.value).toBe(`${window.location.origin}/s/${"a".repeat(64)}`);
      expect(field.readOnly).toBe(true);
    });
  });

  it("列出有效連結並可收回；已撤銷的不再列出", async () => {
    const user = userEvent.setup();
    listQuery.mockReturnValue({ data: [link(), link({ id: "l2", label: "舊連結", revokedAt: new Date() })] });
    render(<ProjectShareCard projectId="p1" canEdit />);

    expect(screen.getByText("給攝影夥伴")).toBeInTheDocument();
    expect(screen.queryByText("舊連結")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收回" }));
    expect(revokeMutate).toHaveBeenCalledWith({ id: "l1" });
  });

  it("檢視者看得到已開的連結，但不能建立也不能收回", () => {
    listQuery.mockReturnValue({ data: [link()] });
    render(<ProjectShareCard projectId="p1" canEdit={false} />);

    expect(screen.getByText("給攝影夥伴")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "建立分享連結" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收回" })).not.toBeInTheDocument();
  });

  it("把「連結就是憑證」講在使用者眼前，而不是只寫在程式碼註解裡", () => {
    render(<ProjectShareCard projectId="p1" canEdit />);
    expect(screen.getByText(/傳給誰就等於開放給誰/)).toBeInTheDocument();
    expect(screen.getByText(/不必登入/)).toBeInTheDocument();
  });
});
