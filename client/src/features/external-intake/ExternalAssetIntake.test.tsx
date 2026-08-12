import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExternalAssetIntake } from "./ExternalAssetIntake";

const invalidate = vi.fn();

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({
      externalIntake: { inbox: { invalidate }, activeSessions: { invalidate } },
      projects: { assets: { invalidate } },
      externalEditing: { list: { invalidate } },
    }),
    externalIntake: {
      activeSessions: { useQuery: () => ({ data: [] }) },
      importUrl: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      importDriveFile: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("../../components/interactions", () => ({ useFocusTrap: () => undefined }));
vi.mock("../../components/GoogleDrivePicker", () => ({ GoogleDrivePicker: () => <div>Drive picker</div> }));
vi.mock("./ExternalImportInbox", () => ({ ExternalImportInbox: () => null }));
vi.mock("../folder-import/FolderImportPanel", () => ({ FolderImportPanel: () => <div>Folder picker</div> }));
vi.mock("./mediaMetadata", () => ({ readLocalMediaMetadata: vi.fn(async () => ({})) }));

describe("ExternalAssetIntake", () => {
  it("portals the command-center mini workspace above the persistent Assistant", async () => {
    const { container } = render(
      <ExternalAssetIntake
        projectId="11111111-1111-4111-8111-111111111111"
        triggerLabel="＋"
        dialogTitle="加入資料"
      />,
    );
    const trigger = screen.getByRole("button", { name: "加入資料" });
    expect(trigger).toHaveTextContent("＋");
    await userEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "加入資料" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.closest(".external-intake-scrim")).toBe(document.body.lastElementChild);
    expect(container.contains(dialog)).toBe(false);
    expect(screen.getByRole("heading", { name: "加入資料" })).toBeInTheDocument();
  });
});
