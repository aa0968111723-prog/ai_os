import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetImg } from "./MediaFallback";

describe("AssetImg defaults", () => {
  it("defaults to lazy + async so list thumbs do not contend for bandwidth", () => {
    const { container } = render(<AssetImg src="https://example.test/a.png" alt="a" />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("lets callers override loading (lightbox / single-shot studio)", () => {
    const { container } = render(
      <AssetImg src="https://example.test/a.png" alt="a" loading="eager" decoding="sync" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("decoding", "sync");
  });
});
