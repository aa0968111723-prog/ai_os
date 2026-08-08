import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryOperations } from "./LibraryOperations";

const { state } = vi.hoisted(() => ({
  state: {
    role: "leader",
    mutate: vi.fn(),
    processingInvalidate: vi.fn(),
    summaryInvalidate: vi.fn(),
  },
}));

vi.mock("../../api", () => ({
  trpc: {
    auth: {
      me: { useQuery: () => ({ data: { user: { isSuperAdmin: false }, groups: [{ groupId: "g1", role: state.role }] } }) },
    },
    intelligence: {
      providerStatus: { useQuery: () => ({ data: { externalActive: false, activeModelVersion: "local-v1" } }) },
      scheduleBackfill: {
        useMutation: (options: { onSuccess: (result: { scheduled: number; eligible: number }) => void }) => ({
          mutate: (input: unknown) => {
            state.mutate(input);
            options.onSuccess({ scheduled: 7, eligible: 7 });
          },
          isPending: false,
          error: null,
        }),
      },
    },
    useUtils: () => ({
      intelligence: {
        processing: { invalidate: state.processingInvalidate },
        summary: { invalidate: state.summaryInvalidate },
      },
    }),
  },
}));

describe("Intelligence Library operations", () => {
  beforeEach(() => {
    state.role = "leader";
    state.mutate.mockReset();
    state.processingInvalidate.mockReset();
    state.summaryInvalidate.mockReset();
  });

  it("lets a leader schedule a bounded model-change backfill", async () => {
    render(<LibraryOperations groupId="g1" projectId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: /補齊舊資料分析/ }));
    expect(state.mutate).toHaveBeenCalledWith({
      groupId: "g1",
      projectId: "p1",
      mode: "model_changed",
      limit: 100,
      dryRun: false,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("已排入 7 項");
  });

  it("does not expose the backfill action to members", () => {
    state.role = "member";
    render(<LibraryOperations groupId="g1" />);
    expect(screen.queryByRole("button", { name: /補齊舊資料分析/ })).toBeNull();
  });
});
