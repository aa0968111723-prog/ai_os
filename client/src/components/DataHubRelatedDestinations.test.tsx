import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataHubRelatedDestinations } from "./DataHubRelatedDestinations";

vi.mock("../lib/lazyWithRetry", () => ({
  lazyWithRetry: () =>
    function KnowledgeMapCardStub() {
      return <div data-testid="knowledge-map-card">map</div>;
    },
}));

describe("DataHubRelatedDestinations", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("renders knowledge map and downloads anchors that keep old download routes", () => {
    render(<DataHubRelatedDestinations groupId="g1" />);
    expect(document.getElementById("knowledge-map")).toBeTruthy();
    expect(document.getElementById("hub-downloads")).toBeTruthy();
    expect(screen.getByTestId("knowledge-map-card")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打開共用下載" })).toHaveAttribute("href", "/downloads");
    expect(screen.getByRole("link", { name: "電腦版應用程式" })).toHaveAttribute("href", "/downloads#desktop-app");
  });
});
