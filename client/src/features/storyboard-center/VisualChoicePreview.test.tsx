import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VisualChoicePreview } from "./VisualChoicePreview";

describe("VisualChoicePreview starter asset fallback", () => {
  it("renders the manifest image first and its semantic SVG fallback on error", () => {
    render(<VisualChoicePreview resource={{
      kind: "image",
      source: "static",
      src: "/creative-choice/starter-v1/camera/camera.close.webp",
      alt: "特寫：臉部與情緒",
      version: "starter-v1",
      aspect: "3:2",
      fallback: { kind: "composition", motif: "close", alt: "特寫：臉部與情緒" },
    }} />);
    fireEvent.error(screen.getByRole("img", { name: "特寫：臉部與情緒" }));
    expect(screen.getByRole("img", { name: "特寫：臉部與情緒" }).tagName).toBe("svg");
  });
});
