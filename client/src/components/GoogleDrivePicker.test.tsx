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
    useUtils: () => ({ databases: { listFiles: { invalidate: () => {} } } }),
    integrations: {
      listDriveFiles: { useQuery: () => ({ data: queryState.data, error: null, isFetching: false }) },
    },
    databases: {
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

  it("未連結：顯示「只讀你選中的檔案」CTA，不出現匯入按鈕", () => {
    queryState.data = { ok: false, reason: "not-connected", message: "尚未連結 Google 雲端" };
    render(<GoogleDrivePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/只會讀「你選中的檔案」，不是整顆雲端/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /前往連結 Google/ })).toHaveAttribute("href", "/integrations");
    expect(screen.queryByRole("button", { name: /匯入選取/ })).toBeNull();
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
