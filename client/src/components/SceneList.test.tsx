/**
 * 分鏡・交付（SceneList）深度優化後的三件事：
 * 1. 精簡分鏡格——每格一顆「依狀態決定的主要動作」，深改集中到單格工作室；
 * 2. 流程引導——四階段條與「下一步」提示要指對地方；
 * 3. 交付中心——就緒度講清楚、單檔收進進階摺疊。
 * 隔離 trpc mock；SceneStudio／StoryboardPlayer 用 stub（各自有獨立測試）。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SceneList } from "./SceneList";

const scenesQuery = vi.fn();
const meQuery = vi.fn();
const updateMutate = vi.fn();
const generateMutate = vi.fn();
const insertAfterMutate = vi.fn();
const moveMutate = vi.fn();
const removeMutate = vi.fn();
const exportCreateMutate = vi.fn();
const invalidateScenes = vi.fn();
const invalidateMessages = vi.fn();
const invalidateDeleted = vi.fn();
const lastUpdateSuccess = { current: undefined as undefined | (() => void) };
const lastRemoveSuccess = { current: undefined as undefined | (() => void) };
/** 專案層卡片庫（逐案覆寫）：文字腳本的卡片行是靠這三份把 id 翻成名字的 */
const cardLists: {
  characters: Array<{ id: string; name: string }>;
  scenePresets: Array<{ id: string; name: string }>;
  props: Array<{ id: string; name: string; ownerName: string | null }>;
} = { characters: [], scenePresets: [], props: [] };

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      scenes: { listByProject: { invalidate: invalidateScenes } },
      messages: { list: { invalidate: invalidateMessages }, openCountsByScene: { invalidate: vi.fn() } },
      projects: { listDeleted: { invalidate: invalidateDeleted } },
    }),
    auth: { me: { useQuery: (...args: unknown[]) => meQuery(...args) } },
    scenes: {
      listByProject: { useQuery: (...args: unknown[]) => scenesQuery(...args) },
      update: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          lastUpdateSuccess.current = opts?.onSuccess;
          return { mutate: updateMutate, isPending: false, error: null };
        },
      },
      generateInto: { useMutation: () => ({ mutate: generateMutate, isPending: false, error: null }) },
      insertAfter: {
        useMutation: (opts?: { onSuccess?: (row: { id: string }) => void }) => ({
          mutate: (input: { sceneId: string; duplicate?: boolean }) => {
            insertAfterMutate(input);
            opts?.onSuccess?.({ id: `new-from-${input.sceneId}` });
          },
          mutateAsync: async (input: { sceneId: string; duplicate?: boolean }) => {
            insertAfterMutate(input);
            const created = { id: `new-from-${input.sceneId}` };
            opts?.onSuccess?.(created);
            return created;
          },
          isPending: false,
          error: null,
        }),
      },
      move: { useMutation: () => ({ mutate: moveMutate, isPending: false, error: null }) },
      remove: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          lastRemoveSuccess.current = opts?.onSuccess;
          return { mutate: removeMutate, isPending: false, error: null };
        },
      },
    },
    // 未改好的標注數（分鏡格的「⚑ N」角標）——本檔不測角標，另有專屬情境；這裡回空清單
    messages: { openCountsByScene: { useQuery: () => ({ data: [], isLoading: false }) } },
    // 文字腳本的卡片三行要讀這三份清單才翻得出名字（SceneList 自己查，不能靠 stub 子元件躲掉）
    characters: { list: { useQuery: () => ({ data: cardLists.characters, isLoading: false }) } },
    scenePresets: { list: { useQuery: () => ({ data: cardLists.scenePresets, isLoading: false }) } },
    props: { list: { useQuery: () => ({ data: cardLists.props, isLoading: false }) } },
    exportJobs: {
      create: { useMutation: () => ({ mutate: exportCreateMutate, isPending: false, error: null }) },
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      cancel: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
  },
}));
vi.mock("./SceneStudio", () => ({
  SceneStudio: ({ sceneNumber }: { sceneNumber: number }) => <div role="dialog" aria-label={`單格工作室 stub 第 ${sceneNumber} 鏡`} />,
}));
vi.mock("./StoryboardPlayer", () => ({ StoryboardPlayer: () => <div aria-label="粗剪預覽 stub" /> }));
// 逐鏡卡片綁定自帶卡片清單查詢，另有專屬測試（SceneCardBinding.test.tsx）——這裡 stub 掉，
// 讓本檔專注在分鏡格自己的狀態機
vi.mock("./SceneCardBinding", () => ({ SceneCardBinding: () => <div aria-label="逐鏡卡片綁定 stub" /> }));
// 逐鏡預覽自帶 generation.preview mutation，同樣另有專屬測試
vi.mock("./ScenePromptPreview", () => ({ ScenePromptPreview: () => <div aria-label="逐鏡預覽 stub" /> }));
// 文字腳本另有專屬測試（StoryboardScript.test.tsx）；本檔專注在分鏡格的狀態機。
// stub 仍然捕捉 rows——「傳了哪些欄位進去」是 SceneList 的責任，而漏一個欄位不會讓
// 任何既有測試變紅（環境音就這樣漏過一次，還把使用者寫好的值靜默清空）。
const storyboardRows = vi.fn();
vi.mock("./StoryboardScript", () => ({
  StoryboardScript: (props: { rows: unknown[] }) => {
    storyboardRows(props.rows);
    return <div aria-label="文字腳本 stub" />;
  },
}));
vi.mock("../discuss", () => ({ discussInMessages: vi.fn() }));

type SceneOver = {
  id: string;
  title?: string;
  status?: string;
  hasAsset?: boolean;
  prompt?: string | null;
  voiceover?: string | null;
  /** 旁白音檔網址。刻意只用 narrationUrl——scenes.listByProject 的投影就只有它，
   *  mock 若多餵一個 narrationAssetId，測試會綠但實機永遠判為「沒有旁白」。 */
  narrationUrl?: string | null;
  ambience?: string | null;
  action?: string | null;
  dialogue?: string | null;
  music?: string | null;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
  assetKind?: string | null;
  assetUrl?: string | null;
  pendingGenStatus?: string | null;
};

function scene(over: SceneOver) {
  const hasAsset = over.hasAsset ?? true;
  return {
    id: over.id,
    title: over.title ?? `鏡 ${over.id}`,
    orderIndex: 0,
    durationSec: 5,
    status: over.status ?? "todo",
    assetId: hasAsset ? `asset-${over.id}` : null,
    prompt: over.prompt === undefined ? "海邊遠景" : over.prompt,
    voiceover: over.voiceover ?? null,
    assetUrl: hasAsset ? (over.assetUrl ?? `https://example.test/${over.id}.png`) : null,
    assetKind: hasAsset ? (over.assetKind ?? "image") : null,
    generationId: null,
    pendingGenStatus: over.pendingGenStatus ?? null,
    narrationUrl: over.narrationUrl ?? null,
    pendingVoiceStatus: null,
    ambience: over.ambience ?? null,
    action: over.action ?? null,
    dialogue: over.dialogue ?? null,
    music: over.music ?? null,
    ambienceUrl: null,
    pendingAmbienceStatus: null,
    characterIds: over.characterIds ?? null,
    scenePresetIds: over.scenePresetIds ?? null,
    propIds: over.propIds ?? null,
  };
}

function mount(over: { canEdit?: boolean } = {}) {
  return render(<SceneList projectId="p-1" canEdit={over.canEdit ?? true} />);
}

const rowOf = (id: string) => {
  const el = document.getElementById(`scene-${id}`);
  if (!el) throw new Error(`scene-${id} not rendered`);
  return within(el as HTMLElement);
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  meQuery.mockReturnValue({ isLoading: false, data: { id: "u-1" } });
  scenesQuery.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  cardLists.characters = [];
  cardLists.scenePresets = [];
  cardLists.props = [];
});

describe("SceneList 流程引導（C）", () => {
  it("有鏡沒畫面：流程條停在「補畫面」，提示帶數字並可一鍵只看無畫面", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", hasAsset: false }), scene({ id: "s2" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(screen.getByText("補畫面").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/還有 1 鏡沒有畫面/)).toBeInTheDocument();
    // 一鍵切到「無畫面」篩選：只剩 s1
    await user.click(screen.getByRole("button", { name: "只看這些" }));
    expect(document.getElementById("scene-s1")).toBeInTheDocument();
    expect(document.getElementById("scene-s2")).not.toBeInTheDocument();
  });

  it("填了配音詞還沒生成旁白：流程條停在「配音」，指路單格工作室", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", voiceover: "大家好" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(screen.getByText("配音").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/1 鏡已填配音詞、還沒生成旁白/)).toBeInTheDocument();
    // 該格 meta 也標出旁白狀態
    expect(rowOf("s1").getByText("旁白未生成")).toBeInTheDocument();
  });

  it("旁白素材被軟刪（narrationUrl 變 null）：仍算「未生成」，流程條退回配音", () => {
    // 鎖住「為什麼判斷要看 narrationUrl 而不是 narrationAssetId」這個不變式：
    // scenes.narrationAssetId 在素材軟刪後刻意保留（供回收桶還原），若拿它判斷，
    // 這一格會假裝成「旁白 ✓」並放行到打包交付，但交付包（已濾軟刪）裡根本沒有那個音檔。
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", voiceover: "大家好", narrationUrl: null })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(rowOf("s1").getByText("旁白未生成")).toBeInTheDocument();
    expect(screen.getByText("配音").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("畫面都齊了：流程條到「打包交付」，交付中心亮綠", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" }), scene({ id: "s2", voiceover: "好", narrationUrl: "https://example.test/n1.mp3" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(screen.getByText("打包交付").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/全部 2 鏡都有畫面了，可以打包交付/)).toBeInTheDocument();
    expect(rowOf("s2").getByText("旁白 ✓")).toBeInTheDocument();
  });
});

describe("SceneList 精簡分鏡格（A）：一顆依狀態決定的主要動作", () => {
  it("無畫面有提示詞→生成這一格；有畫面就只剩單格工作室（沒有送審這種東西了）", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", hasAsset: false }), scene({ id: "s2" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(rowOf("s1").getByRole("button", { name: /^生成這一格/ })).toBeInTheDocument();
    expect(rowOf("s2").queryByRole("button", { name: /送審/ })).not.toBeInTheDocument();
    expect(rowOf("s2").getByRole("button", { name: "單格工作室" })).toBeInTheDocument();
  });

  it("無畫面也沒提示詞→主動作改成開單格工作室寫提示詞", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", hasAsset: false, prompt: null })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    await user.click(rowOf("s1").getByRole("button", { name: /寫提示詞出圖/ }));
    expect(screen.getByRole("dialog", { name: /單格工作室 stub 第 1 鏡/ })).toBeInTheDocument();
  });

  it("檢視者（2.3 唯讀）：沒有任何寫入鈕，仍可開單格工作室、下載與討論", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount({ canEdit: false });
    const row = rowOf("s1");
    expect(row.queryByRole("button", { name: /^生成這一格/ })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "上移" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "刪除" })).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: "單格工作室" })).toBeInTheDocument();
    expect(row.getByText("下載")).toBeInTheDocument();
    expect(row.getByRole("button", { name: /討論/ })).toBeInTheDocument();
  });

  it("點縮圖＝開單格工作室（深改唯一入口）", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    await user.click(rowOf("s1").getByRole("button", { name: /第 1 鏡縮圖/ }));
    expect(screen.getByRole("dialog", { name: /單格工作室 stub 第 1 鏡/ })).toBeInTheDocument();
  });

  it("整理分鏡：在這之後插入一鏡（不必加到最後再一路搬上來）", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" }), scene({ id: "s2" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    await user.click(rowOf("s1").getByRole("button", { name: "在這之後插入一鏡" }));
    expect(insertAfterMutate).toHaveBeenCalledWith({ sceneId: "s1" });
  });

  it("同一格連點插入：第二次起用上一格新 id，避免 LIFO", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" }), scene({ id: "s2" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    const btn = rowOf("s1").getByRole("button", { name: "在這之後插入一鏡" });
    await user.click(btn);
    await user.click(btn);
    await user.click(btn);
    await vi.waitFor(() => expect(insertAfterMutate).toHaveBeenCalledTimes(3));
    expect(insertAfterMutate.mock.calls.map((c) => c[0])).toEqual([
      { sceneId: "s1" },
      { sceneId: "new-from-s1" },
      { sceneId: "new-from-new-from-s1" },
    ]);
  });

  it("複製這一鏡：帶 duplicate 旗標（設定跟著走，成品不跟）", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    await user.click(rowOf("s1").getByRole("button", { name: "複製這一鏡" }));
    expect(insertAfterMutate).toHaveBeenCalledWith({ sceneId: "s1", duplicate: true });
  });

  it("檢視者看不到插入／複製（整理分鏡是寫入動作）", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount({ canEdit: false });
    expect(screen.queryByRole("button", { name: "在這之後插入一鏡" })).toBeNull();
    expect(screen.queryByRole("button", { name: "複製這一鏡" })).toBeNull();
  });
});

describe("SceneList 交付中心（B）", () => {
  it("畫面沒齊：就緒度列出卡在哪；主 CTA 仍可打包", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" }), scene({ id: "s2" }), scene({ id: "s3", hasAsset: false })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    const deliver = within(screen.getByRole("region", { name: "交付" }));
    expect(deliver.getByText(/有畫面 2／3 鏡/)).toBeInTheDocument();
    expect(deliver.getByText(/1 鏡無畫面/)).toBeInTheDocument();
    expect(deliver.getByRole("button", { name: /打包下載交付包/ })).toBeInTheDocument();
  });

  it("單檔下載收進「進階」摺疊區，預設收合", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    const details = document.querySelector(".scene-deliver__advanced");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/進階：只要單檔/)).toBeInTheDocument();
  });
});

/**
 * 文字腳本吃到的欄位。
 *
 * 這一組守的是一條會**吃掉使用者資料**的連鎖，而不是「props 有沒有傳對」的形式檢查：
 * formatStoryboardScript 一律輸出「環境音：」那一行（空的也輸出，讓人知道可以寫），
 * 所以 rows 少帶 ambience 時，畫面上永遠是空的；前端 diff 拿同樣缺值的 rows 比對，
 * 會顯示「沒有任何變更」；但伺服器是拿 DB 真值比對，於是「原封不動寫回」就把
 * 單格工作室寫好的環境音清成空字串——全程沒有任何警告。
 */
describe("SceneList → 文字腳本：整份鏡規格都要傳進去", () => {
  it("帶上環境音——漏掉它，照原樣寫回就會把 DB 裡的環境音清空", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", ambience: "遠處鐘聲，細微蟲鳴" })],
      isLoading: false,
      isError: false,
    });
    mount();
    const rows = storyboardRows.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(rows[0]!.ambience).toBe("遠處鐘聲，細微蟲鳴");
  });

  it("畫面／旁白／標題／秒數一併帶到——任何一欄漏掉都是同一條清空連鎖", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", prompt: "夜裡的禪堂", voiceover: "那一年…", ambience: "蟲鳴", action: "從門口走到窗邊", dialogue: "@師父：坐吧。", music: "起｜鋼琴" })],
      isLoading: false,
      isError: false,
    });
    mount();
    const rows = storyboardRows.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      title: "鏡 s1",
      durationSec: 5,
      prompt: "夜裡的禪堂",
      voiceover: "那一年…",
      ambience: "蟲鳴",
      action: "從門口走到窗邊",
      dialogue: "@師父：坐吧。",
      music: "起｜鋼琴",
    });
  });

  /**
   * 卡片三行現在是**可寫回**的，所以名字錯了不只是顯示問題：
   * 伺服器拿名字回推卡片，對不上就整行不套用——使用者會看到「我明明沒改角色，
   * 寫回一次綁定就說找不到」。素材卡尤其要用顯示名（「安倢的紅傘」），
   * 因為原名撞名時伺服器會判成有歧義而整行不套用。
   */
  it("卡片三行各自帶名字，素材卡用含主人的顯示名", () => {
    cardLists.characters = [{ id: "c1", name: "安倢" }, { id: "c2", name: "師父" }];
    cardLists.scenePresets = [{ id: "p1", name: "禪堂" }];
    cardLists.props = [{ id: "r1", name: "紅傘", ownerName: "安倢" }];
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", characterIds: ["c2", "c1"], scenePresetIds: ["p1"], propIds: ["r1"] })],
      isLoading: false,
      isError: false,
    });
    mount();
    const rows = storyboardRows.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      // 順序照綁定順序，不重排——它決定提示詞裡卡片的組裝順序
      characterNames: ["師父", "安倢"],
      scenePresetNames: ["禪堂"],
      propNames: ["安倢的紅傘"],
    });
  });

  it("卡片被刪掉時那個名字直接消失，不會寫出一個回不去的名字", () => {
    cardLists.characters = [{ id: "c1", name: "安倢" }];
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", characterIds: ["c1", "c-gone"] })],
      isLoading: false,
      isError: false,
    });
    mount();
    const rows = storyboardRows.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(rows[0]!.characterNames).toEqual(["安倢"]);
  });
});

describe("SceneList 長分鏡效能", () => {
  function refetchIntervalOf() {
    const opts = scenesQuery.mock.calls.at(-1)?.[1] as {
      refetchInterval?: (q: { state: { data: unknown } }) => number;
    };
    expect(typeof opts?.refetchInterval).toBe("function");
    return opts.refetchInterval!;
  }

  it("沒有進行中生成時用 45 秒心跳，有 queued/running 才 10 秒", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mount();
    const interval = refetchIntervalOf();
    expect(interval({ state: { data: [scene({ id: "s1" })] } })).toBe(45_000);
    expect(interval({ state: { data: [scene({ id: "s1", pendingGenStatus: "running" })] } })).toBe(10_000);
  });

  it("影片鏡列用靜態縮圖，不掛 <video>", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", assetKind: "video", assetUrl: "https://example.test/s1.mp4" })],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mount();
    const row = document.getElementById("scene-s1");
    expect(row?.querySelector("video")).toBeNull();
    expect(rowOf("s1").getByRole("img", { name: /影片/ })).toBeInTheDocument();
  });

  it("改標題只刷新分鏡清單；刪除才連帶訊息與回收桶", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mount();
    lastUpdateSuccess.current?.();
    expect(invalidateScenes).toHaveBeenCalled();
    expect(invalidateMessages).not.toHaveBeenCalled();
    expect(invalidateDeleted).not.toHaveBeenCalled();

    invalidateScenes.mockClear();
    lastRemoveSuccess.current?.();
    expect(invalidateScenes).toHaveBeenCalled();
    expect(invalidateMessages).toHaveBeenCalled();
    expect(invalidateDeleted).toHaveBeenCalled();
  });
});
