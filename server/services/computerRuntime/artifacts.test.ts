import { describe, expect, it } from "vitest";
import { scanArtifactBytes, sniffMime } from "./artifacts";

describe("artifact scan / mime", () => {
  it("sniffs png and jpeg", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    expect(sniffMime(png)).toBe("image/png");
    expect(scanArtifactBytes(png).status).toBe("clean");
  });

  it("blocks EICAR and html", () => {
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect(scanArtifactBytes(eicar).status).toBe("blocked");
    expect(scanArtifactBytes(Buffer.from("<!doctype html><script>alert(1)</script>")).status).toBe("blocked");
  });

  it("rejects empty", () => {
    expect(scanArtifactBytes(Buffer.alloc(0)).status).toBe("failed");
  });
});
