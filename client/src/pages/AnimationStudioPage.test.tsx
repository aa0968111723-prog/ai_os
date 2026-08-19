import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const XIAOHUA_ID = "81b265dc-d41c-4ace-ae8f-c05b6debefec";
const OTHER_GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANIM_GROUP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const listQuery = vi.fn();
const getQuery = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    projects: {
      list: { useQuery: (...args: unknown[]) => listQuery(...args) },
      get: { useQuery: (...args: unknown[]) => getQuery(...args) },
    },
  },
}));

vi.mock("../features/animation-studio/AnimationStudio", () => ({
  AnimationStudio: (props: { projectId: string; projectTitle: string }) => (
    <div>{`創作室 ${props.projectTitle} ${props.projectId}`}</div>
  ),
}));

import { AnimationStudioPage } from "./AnimationStudioPage";

describe("AnimationStudioPage picker lists 動畫組 without creating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listQuery.mockReturnValue({
      data: [
        {
          id: XIAOHUA_ID,
          groupId: ANIM_GROUP,
          title: "小華",
          format: "9:16",
          kind: "animation",
          coverUrl: null,
          myProjectRole: "editor",
          status: "active",
        },
      ],
      isLoading: false,
    });
    getQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("bare /studio lists 動畫組 小華 and opens /studio/:id; does not create a project", () => {
    render(<AnimationStudioPage groupId={OTHER_GROUP} />);
    expect(listQuery).toHaveBeenCalledWith({});
    expect(screen.getByText("小華")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /小華/ })).toHaveAttribute("href", `/studio/${XIAOHUA_ID}`);
    expect(screen.queryByRole("button", { name: /建立/ })).toBeNull();
    expect(screen.queryByText(/去建立專案/)).toBeNull();
  });

  it("opens the chosen project via projects.get, not the active-group list", () => {
    getQuery.mockReturnValue({
      data: {
        id: XIAOHUA_ID,
        title: "小華",
        format: "9:16",
        myProjectRole: "editor",
        status: "active",
      },
      isLoading: false,
    });
    render(<AnimationStudioPage groupId={OTHER_GROUP} projectId={XIAOHUA_ID} />);
    expect(getQuery).toHaveBeenCalledWith(
      { id: XIAOHUA_ID },
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText(`創作室 小華 ${XIAOHUA_ID}`)).toBeInTheDocument();
  });
});
