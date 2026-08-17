import { afterEach, describe, expect, it } from "vitest";
import {
  consumeNestedReveal,
  peekStoryReveal,
  publishStoryReveal,
  subscribeStoryReveal,
} from "./storyRevealQueue";

describe("storyRevealQueue", () => {
  afterEach(() => {
    consumeNestedReveal();
    publishStoryReveal({ section: "characters" });
  });

  it("keeps the latest reveal until a subscriber arrives", () => {
    const seen: string[] = [];
    publishStoryReveal({ section: "production", nestedSelector: "#sec-assistant" });
    expect(peekStoryReveal()).toMatchObject({
      section: "production",
      nestedSelector: "#sec-assistant",
    });
    const stop = subscribeStoryReveal((next) => {
      seen.push(next.section);
    });
    expect(seen).toEqual(["production"]);
    expect(consumeNestedReveal()).toBe("#sec-assistant");
    expect(peekStoryReveal()?.nestedSelector).toBeUndefined();
    stop();
  });

  it("replays the durable inbox to late subscribers", () => {
    publishStoryReveal({
      section: "production",
      nestedSelector: "#sec-generations",
    });
    let latest = "";
    const stop = subscribeStoryReveal((next) => {
      latest = next.nestedSelector ?? "";
    });
    expect(latest).toBe("#sec-generations");
    stop();
  });
});
