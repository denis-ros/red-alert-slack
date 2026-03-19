import { describe, expect, it } from "vitest";

import { MessageDeduper } from "../src/alerts/dedupe.js";

describe("MessageDeduper", () => {
  it("drops repeats within the ttl window", () => {
    const deduper = new MessageDeduper(10, 1_000);

    expect(deduper.hasSeen("alert:1", 100)).toBe(false);
    expect(deduper.hasSeen("alert:1", 500)).toBe(true);
    expect(deduper.hasSeen("alert:1", 1_500)).toBe(false);
  });
});

