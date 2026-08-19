/**
 * 100 ShotCards in pro mode must not each fire a suggestion query.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShotCard, type ShotRow } from "./ShotCard";

const { invalidate, suggestionUseQuery, batchUseQuery } = vi.hoisted(() => ({
  invalidate: vi.fn(),
  suggestionUseQuery: vi.fn(() => ({ data: { items: [] } })),
  batchUseQuery: vi.fn(() => ({ data: undefined })),
}));

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({
      scenes: { listByProject: { invalidate } },
      externalIntake: { inbox: { invalidate } },
      projects: { assets: { invalidate } },
      story: { shotAssetSuggestionsBatch: { invalidate } },
    }),
    scenes: {
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      insertAfter: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      inheritFromPrevious: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, data: undefined }) },
      setVisualFromAsset: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
    externalIntake: { confirm: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) } },
    story: {
      shotAssetSuggestions: { useQuery: suggestionUseQuery },
      shotAssetSuggestionsBatch: { useQuery: batchUseQuery },
    },
    projects: { assets: { useQuery: () => ({ data: [], isLoading: false }) } },
    characters: { list: { useQuery: () => ({ data: [] }) } },
    scenePresets: { list: { useQuery: () => ({ data: [] }) } },
    props: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("../../components/SceneCardBinding", () => ({
  SceneCardBinding: () => <div />,
}));
vi.mock("../external-intake/ExternalAssetIntake", () => ({
  ExternalAssetIntake: () => null,
}));
vi.mock("../external-intake/ExternalGenerationLauncher", () => ({
  ExternalGenerationLauncher: () => null,
}));
vi.mock("../external-intake/mediaMetadata", () => ({
  readLocalMediaMetadata: vi.fn(async () => ({})),
}));

function shot(i: number): ShotRow {
  return {
    id: `shot-${i}`,
    title: `鏡 ${i}`,
    orderIndex: i,
    durationSec: 3,
    status: "todo",
    prompt: null,
    action: null,
    dialogue: null,
    voiceover: null,
    assetId: null,
    assetUrl: null,
    assetKind: null,
    characterIds: [],
    scenePresetIds: [],
    propIds: [],
    storySceneId: null,
    camera: null,
    performance: null,
    lookIds: [],
    pendingGenStatus: null,
  };
}

describe("ShotCard suggestion fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });

  it("100 pro-mode cards with injected hints do not call per-shot suggestion queries", () => {
    const hints = [{ id: "a1", title: "安倢", kind: "image", url: "/a.jpg", matched: ["安倢"] }];
    render(
      <div>
        {Array.from({ length: 100 }, (_, i) => (
          <ShotCard
            key={i}
            projectId="p1"
            shot={shot(i)}
            shotNumber={i + 1}
            canEdit
            mode="pro"
            looks={[]}
            characterNames={new Map()}
            onOpenStudio={vi.fn()}
            assetHints={hints}
          />
        ))}
      </div>,
    );
    expect(suggestionUseQuery).not.toHaveBeenCalled();
    expect(batchUseQuery).not.toHaveBeenCalled();
  });
});
