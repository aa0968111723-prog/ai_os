import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleDrivePicker } from "./GoogleDrivePicker";

/**
 * PR-E1/E3 前端關鍵路徑：未連結 CTA（範圍透明文案）、選取模式回傳勾選、
 * 資料夾可點入縮小範圍、共用檔擁有者提示。
 */

const { queryState } = vi.hoisted(() => ({ queryState: { data: null as unknown } }));

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      databases: { listFiles: { invalidate: () => {} } },
      knowledge: { list: { invalidate: () => {} } },
    }),
    integrations: {
      listDriveFiles: { useQuery: () => ({ data: queryState.data, error: null, isFetching: false }) },
    },
    databases: {
      importDriveFile: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false, error: null }) },
    },
    knowledge: {
      importDriveFile: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false, error: null }) },
    },
  },
}));

const FILE = {
  id: "f1", name: "週報.pdf", mimeType: "application/pdf",
  size: 1024, modifiedTime: "2026-07-01T00:00:00Z", isFolder: false, owner: null, ownedByMe: true,
};
const SHARED_FILE = {
  id: "f2", name: "共用腳本", mimeType: "application/vnd.google-apps.document",
  size: null, modifiedTime: null, isFolder: false, owner: "王小明", ownedByMe: false,
};
const FOLDER = {
  id: "d1", name: "企劃資料夾", mimeType: "application/vnd.google-apps.folder",
  size: null, modifiedTime: null, isFolder: true, owner: null, ownedByMe: true,
};

describe("GoogleDrivePicker", () => {
  beforeEach(() => { queryState.data = null; });

  // 資料中心 P2 契約變更：未連結不再把人丟到 /integrations 自己找路走回來。
  // CTA 直接開始授權，並把「現在這個畫面」簽進 return，callback 會導回這裡（Golden Path 1／5）。
  it("未連結：顯示「只讀你選中的檔案」CTA，且直接開始授權並帶回跳目的地", () => {
    queryState.data = { ok: false, reason: "not-connected", message: "尚未連結 Google 雲端" };
    render(<GoogleDrivePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/只會讀「你選中的檔案」，不是整顆雲端/)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /連接 Google 雲端/ });
    expect(cta.getAttribute("href")).toContain("/api/integrations/google-drive/start");
    expect(cta.getAttribute("href")).toContain("return=");
    expect(screen.queryByRole("button", { name: /匯入選取/ })).toBeNull();
  });

  it("授權失效：錯誤訊息旁就有「重新連接」，不必離開這個畫面", () => {
    queryState.data = { ok: false, reason: "error", message: "授權已失效" };
    render(<GoogleDrivePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("授權已失效");
    expect(screen.getByRole("link", { name: /重新連接/ }).getAttribute("href"))
      .toContain("/api/integrations/google-drive/start");
  });

  it("專案目的地：主按鈕改成「加入這個專案」，文案講的是 AI 讀得到什麼", () => {
    queryState.data = { ok: true, email: "me@gmail.com", files: [FILE], nextPageToken: null };
    render(<GoogleDrivePicker projectId="p1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /加入這個專案/ })).toBeInTheDocument();
    expect(screen.getByText(/加入後這個專案的 AI 就讀得到/)).toBeInTheDocument();
  });

  it("選取模式：勾選後按「僅本次規劃」回傳檔案並關閉；不打匯入 API", async () => {
    queryState.data = { ok: true, email: "me@gmail.com", files: [FILE], nextPageToken: null };
    const onPick = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<GoogleDrivePicker onClose={onClose} onPick={onPick} pickLabel="僅本次規劃" />);
    expect(screen.getByText(/目前以 me@gmail.com 瀏覽/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /僅本次規劃（1）/ }));
    expect(onPick).toHaveBeenCalledWith([{ id: "f1", name: "週報.pdf" }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("選取模式＋轉存：另有「轉存進知識庫」建議按鈕", async () => {
    queryState.data = { ok: true, email: "me@gmail.com", files: [FILE], nextPageToken: null };
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<GoogleDrivePicker onClose={() => {}} onPick={() => {}} onSaveToKnowledge={onSave} />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /轉存進知識庫（1）/ }));
    expect(onSave).toHaveBeenCalledWith([{ id: "f1", name: "週報.pdf" }]);
  });

  it("資料夾列可點入（不可勾選）；共用檔顯示擁有者提示", () => {
    queryState.data = { ok: true, email: "me@gmail.com", files: [FOLDER, SHARED_FILE], nextPageToken: null };
    render(<GoogleDrivePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /企劃資料夾/ })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1); // 資料夾無 checkbox
    expect(screen.getByText(/共用：王小明/)).toBeInTheDocument();
  });
});
