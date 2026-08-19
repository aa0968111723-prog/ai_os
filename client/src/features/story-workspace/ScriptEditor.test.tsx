/**
 * 劇本編輯器的接線測試：純規則已由 scriptTools.test.ts 守住，這裡守
 * 「按鈕／快捷鍵真的接到那些規則」與「唯讀身分不會被給編輯工具」——
 * 接線斷掉時規則測試照樣全綠，只有使用者會發現按了沒反應。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ScriptEditor, SCRIPT_FONT_STORAGE_KEY } from "./ScriptEditor";

/** 受控元件：照實模擬 StoryStage 的用法（值回寫，才測得到連續操作） */
function Harness({ initial = "", canEdit = true }: { initial?: string; canEdit?: boolean }) {
  const [value, setValue] = useState(initial);
  return <ScriptEditor value={value} onChange={setValue} canEdit={canEdit} rows={8} placeholder="寫故事…" />;
}

const editor = () => screen.getByLabelText("故事內容") as HTMLTextAreaElement;

describe("ScriptEditor", () => {
  it("選取名字按「角色」→ 上方多一行宣告，原文保留", async () => {
    const user = userEvent.setup();
    render(<Harness initial="安倢撐著紅傘走下石階。" />);
    editor().setSelectionRange(0, 2);
    await user.click(screen.getByRole("button", { name: "角色" }));
    expect(editor().value).toBe("角色：安倢\n安倢撐著紅傘走下石階。");
  });

  it("快捷鍵 Alt+5 標對白、再按一次取消（手不用離開稿子）", async () => {
    const user = userEvent.setup();
    render(<Harness initial="我等了你很久。" />);
    await user.click(editor());
    await user.keyboard("{Alt>}5{/Alt}");
    expect(editor().value).toBe("對白：我等了你很久。");
    await user.keyboard("{Alt>}5{/Alt}");
    expect(editor().value).toBe("我等了你很久。");
  });

  it("統計即時更新：字數不含註記，段數＝空行分段", async () => {
    render(<Harness initial={"清晨下著雨。\n\n師父在等她。\n註：這段待補"} />);
    expect(screen.getByText("12 字")).toBeTruthy();
    expect(screen.getByText("2 段")).toBeTruthy();
    expect(screen.getByText(/註記 6 字/)).toBeTruthy();
  });

  it("大綱列出每一段，點一下把游標送過去", async () => {
    const user = userEvent.setup();
    render(<Harness initial={"清晨下著雨。\n\n師父在坡頂等她。"} />);
    await user.click(screen.getByRole("button", { name: /大綱/ }));
    const second = screen.getByRole("button", { name: /第 2 段/ });
    await user.click(second);
    expect(editor().selectionStart).toBe("清晨下著雨。\n\n".length);
  });

  it("Ctrl+F 不打開尋找列、也不 preventDefault（瀏覽器尋找要出得來）", () => {
    const { container } = render(<Harness initial="小華走進淡大校門口。" />);
    const host = container.querySelector(".script-editor");
    expect(host).toBeTruthy();
    const allowed = fireEvent.keyDown(host!, { key: "f", ctrlKey: true });
    expect(allowed).toBe(true);
    expect(screen.queryByLabelText("尋找")).toBeNull();
  });

  it("尋找／取代改得掉主角名字，但不動註記行", async () => {
    const user = userEvent.setup();
    render(<Harness initial={"安倢走了。\n註：安倢原本叫小美\n安倢回頭。"} />);
    await user.click(screen.getByRole("button", { name: /尋找/ }));
    await user.type(screen.getByLabelText("尋找"), "安倢");
    expect(screen.getByText("1 / 3")).toBeTruthy();
    await user.type(screen.getByLabelText("取代為"), "阿倢");
    await user.click(screen.getByRole("button", { name: "全部取代" }));
    expect(editor().value).toBe("阿倢走了。\n註：安倢原本叫小美\n阿倢回頭。");
    expect(screen.getByText(/已取代 2 處/)).toBeTruthy();
  });

  it("全螢幕切換掛上沉浸樣式與 body class（全站浮動殼層讓開）", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^全螢幕$/ }));
    expect(container.querySelector(".script-editor.is-immersive")).toBeTruthy();
    expect(document.body.classList.contains("story-immersive")).toBe(true);
    await user.click(screen.getByRole("button", { name: /離開全螢幕/ }));
    expect(document.body.classList.contains("story-immersive")).toBe(false);
  });

  it("稿子聚焦＝手機鍵盤在畫面上：掛 is-typing 讓底部工具讓位，失焦收回", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const host = () => container.querySelector(".script-editor")!;
    expect(host().classList.contains("is-typing")).toBe(false);
    await user.click(editor());
    expect(host().classList.contains("is-typing")).toBe(true);
    fireEvent.blur(editor());
    expect(host().classList.contains("is-typing")).toBe(false);
  });

  it("接了 onBlur 的呼叫端照樣收得到失焦（讓位邏輯不能吃掉存檔 flush）", async () => {
    const user = userEvent.setup();
    let blurs = 0;
    render(
      <ScriptEditor
        value="安倢走了。"
        onChange={() => {}}
        onBlur={() => { blurs += 1; }}
        canEdit
        rows={8}
        placeholder="寫故事…"
      />,
    );
    await user.click(editor());
    fireEvent.blur(editor());
    expect(blurs).toBe(1);
  });

  it("Esc 離開全螢幕（系統手勢之外的第二條退路）", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^全螢幕$/ }));
    await user.click(editor());
    await user.keyboard("{Escape}");
    expect(document.body.classList.contains("story-immersive")).toBe(false);
  });

  it("唯讀身分：稿子看得到，標注鈕一顆都不給（不是給了再擋）", () => {
    render(<Harness initial="安倢走了。" canEdit={false} />);
    expect(editor().readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "角色" })).toBeNull();
    // 讀者仍需要導覽與量測工具
    expect(screen.getByRole("button", { name: /大綱/ })).toBeTruthy();
  });

  it("唯讀身分不給取代（尋找可以用）", async () => {
    const user = userEvent.setup();
    render(<Harness initial="安倢走了。" canEdit={false} />);
    await user.click(screen.getByRole("button", { name: /尋找/ }));
    expect(screen.getByLabelText("尋找")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "全部取代" })).toBeNull();
  });

  it("字級偏好留在 localStorage（下次打開還是同一個大小）", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem(SCRIPT_FONT_STORAGE_KEY);
    render(<Harness />);
    await user.click(screen.getByLabelText("放大字級"));
    expect(screen.getByText("110%")).toBeTruthy();
    expect(window.localStorage.getItem(SCRIPT_FONT_STORAGE_KEY)).toBe("1.1");
  });
});
