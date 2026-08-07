import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentPanel } from "./AttachmentPanel";

/**
 * 筆記／知識庫附件面板的關鍵路徑：
 * 圖片走縮圖、文件走檔案列與「AI 讀得到 N 字」、唯讀看得到但加不了、
 * 上傳失敗要逐檔說明白（整批默默消失是最讓人火大的失敗方式）。
 */

const { queryState, removeMutate, invalidate } = vi.hoisted(() => ({
  queryState: { data: [] as unknown[], error: null as unknown },
  removeMutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({ attachments: { list: { invalidate } } }),
    attachments: {
      list: { useQuery: () => ({ data: queryState.data, error: queryState.error, isLoading: false }) },
      remove: { useMutation: () => ({ mutate: removeMutate, isPending: false, error: null }) },
    },
  },
}));

const IMAGE = {
  id: "a1", kind: "note", refId: "n1", name: "白板.jpg", mime: "image/jpeg",
  sizeBytes: 204_800, media: "image", readableChars: 0,
  url: "/api/attachments/a1/file", uploadedBy: "u1", uploaderName: "Bruce", createdAt: new Date(),
};
const PDF = {
  id: "a2", kind: "note", refId: "n1", name: "講義.pdf", mime: "application/pdf",
  sizeBytes: 1_048_576, media: "doc", readableChars: 3_120,
  url: "/api/attachments/a2/file", uploadedBy: "u1", uploaderName: "Bruce", createdAt: new Date(),
};

describe("AttachmentPanel", () => {
  beforeEach(() => {
    queryState.data = [];
    queryState.error = null;
    removeMutate.mockReset();
    invalidate.mockReset();
  });

  it("圖片顯示縮圖、文件顯示可讀字數（PDF 進不進得了 AI 一眼看得出來）", () => {
    queryState.data = [IMAGE, PDF];
    render(<AttachmentPanel kind="knowledge" refId="n1" />);
    expect(screen.getByRole("img", { name: "白板.jpg" })).toHaveAttribute("src", "/api/attachments/a1/file");
    expect(screen.getByText("講義.pdf")).toBeInTheDocument();
    expect(screen.getByText(/3,120 字/)).toBeInTheDocument();
    // 照片沒有抽取文字，不掛「N 字」——兩個附件只該有一顆可讀字數標籤
    expect(screen.getAllByTitle(/注入 AI 導演/)).toHaveLength(1);
  });

  it("唯讀：看得到附件，但沒有上傳與刪除入口", () => {
    queryState.data = [PDF];
    render(<AttachmentPanel kind="knowledge" refId="n1" readOnly />);
    expect(screen.getByText("講義.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /加附件/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /刪除/ })).not.toBeInTheDocument();
  });

  it("上傳失敗逐檔回報，不是整批默默消失", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 415,
      json: async () => ({ error: "不支援的檔案格式（application/x-msdownload）" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AttachmentPanel kind="note" refId="n1" />);

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "壞檔.exe", { type: "application/x-msdownload" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/壞檔\.exe：不支援的檔案格式/));
    expect(fetchMock).toHaveBeenCalledWith("/api/attachments/upload", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("上傳成功後讓母體清單重抓（📎 計數才會跟上）", async () => {
    const onChanged = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    render(<AttachmentPanel kind="note" refId="n1" onChanged={onChanged} />);

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "白板.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ kind: "note", refId: "n1" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
