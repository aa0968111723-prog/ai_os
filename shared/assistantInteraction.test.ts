import { describe, expect, it } from "vitest";
import {
  intakePickerInteraction,
  projectPickerInteraction,
  sourcePickerInteraction,
} from "./assistantInteraction";

describe("assistantInteraction", () => {
  it("source picker offers structured cloud choices without free-text hunting", () => {
    const request = sourcePickerInteraction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(request.kind).toBe("SOURCE_PICKER");
    expect(request.options.map((option) => option.label)).toEqual([
      "Google Drive",
      "Google Photos",
      "Aios 素材",
      "手機檔案",
    ]);
    expect(request.options.every((option) => !!option.prompt)).toBe(true);
  });

  it("project picker keeps numbered continuation prompts", () => {
    const request = projectPickerInteraction([
      { id: "11111111-1111-4111-8111-111111111111", title: "A" },
      { id: "22222222-2222-4222-8222-222222222222", title: "B" },
    ]);
    expect(request.kind).toBe("PROJECT_PICKER");
    expect(request.options[1]?.prompt).toBe("第二個");
  });

  it("drive intake auto-launches the picker", () => {
    const request = intakePickerInteraction({
      mode: "drive",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectTitle: "北藝回顧",
      message: "請選 Drive 檔案",
    });
    expect(request.kind).toBe("DRIVE_PICKER");
    expect(request.autoLaunch).toBe(true);
    expect(request.intakeMode).toBe("drive");
  });
});
