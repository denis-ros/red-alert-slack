import { describe, expect, it } from "vitest";

import { hasMissedHeartbeatWindow } from "../src/alerts/client.js";

describe("AlertWebsocketClient heartbeat helpers", () => {
  it("detects a stale gap larger than the heartbeat window", () => {
    expect(hasMissedHeartbeatWindow(1_000, 41_001, 30_000, 10_000)).toBe(true);
  });

  it("does not flag a gap inside the heartbeat window", () => {
    expect(hasMissedHeartbeatWindow(1_000, 40_000, 30_000, 10_000)).toBe(false);
  });
});
