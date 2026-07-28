import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BRAND_MARK_SRC, BRAND_NAME, BRAND_TAGLINE } from "../brand";
import { BrandLogo } from "./BrandLogo";

describe("BrandLogo", () => {
  it("renders mark with fixed dimensions to avoid CLS", () => {
    render(<BrandLogo variant="mark" size="sm" />);
    const img = screen.getByRole("img", { name: BRAND_NAME });
    expect(img).toHaveAttribute("width", "22");
    expect(img).toHaveAttribute("height", "22");
    expect(img).toHaveAttribute("src", BRAND_MARK_SRC.color);
  });

  it("uses monochrome mark path for monochrome tone", () => {
    render(<BrandLogo variant="mark" tone="monochrome" />);
    expect(screen.getByRole("img", { name: BRAND_NAME })).toHaveAttribute(
      "src",
      BRAND_MARK_SRC.monochrome,
    );
  });

  it("full variant exposes accessible name and optional tagline", () => {
    render(<BrandLogo variant="full" size="lg" showTagline />);
    expect(screen.getByRole("img", { name: `${BRAND_NAME} · ${BRAND_TAGLINE}` })).toBeVisible();
    expect(screen.getByText(BRAND_NAME)).toBeVisible();
    expect(screen.getByText(BRAND_TAGLINE)).toBeVisible();
  });

  it("decorative mark is aria-hidden and has empty alt", () => {
    const { container } = render(<BrandLogo variant="mark" decorative />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("does not hardcode asset paths outside brand.ts src map", () => {
    render(<BrandLogo variant="mark" tone="color" size="md" />);
    const src = screen.getByRole("img").getAttribute("src") ?? "";
    expect(src.startsWith("/brand/")).toBe(true);
  });
});
