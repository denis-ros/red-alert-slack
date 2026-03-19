import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { normalizeAreaName } from "../src/config.js";
import type { ParsedAlertEvent } from "../src/alerts/parse.js";
import type { SlackStatusProfile } from "../src/slack/client.js";
import { SlackStatusManager } from "../src/slack/status.js";
import type { PersistedState, StateStore } from "../src/state/store.js";
import { EMPTY_STATE } from "../src/state/store.js";
import { Logger } from "../src/util/log.js";

class InMemoryStateStore implements StateStore {
  state: PersistedState = { ...EMPTY_STATE };

  async load(): Promise<PersistedState> {
    return this.state;
  }

  async save(state: PersistedState): Promise<void> {
    this.state = state;
  }
}

class FakeSlackClient {
  currentProfile: SlackStatusProfile = {
    status_text: "Lunch",
    status_emoji: ":sandwich:",
    status_expiration: 0
  };

  readonly setCalls: SlackStatusProfile[] = [];
  clearCalls = 0;

  async getProfile(): Promise<SlackStatusProfile> {
    return this.currentProfile;
  }

  async setProfile(profile: SlackStatusProfile): Promise<void> {
    this.currentProfile = profile;
    this.setCalls.push(profile);
  }

  async clearStatus(): Promise<void> {
    this.clearCalls += 1;
    this.currentProfile = {
      status_text: "",
      status_emoji: "",
      status_expiration: 0
    };
  }
}

function createConfig(): AppConfig {
  return {
    alertingApproach: "slack-app",
    slackToken: "xoxp-test",
    alertAreas: ["תל אביב - מרכז העיר"],
    normalizedAlertAreas: new Set([normalizeAreaName("תל אביב - מרכז העיר")]),
    statusText: "In shelter",
    statusEmoji: ":rotating_light:",
    statusExpirationSeconds: 900,
    wsUrl: "wss://example.test/socket",
    stateFile: "/tmp/state.json",
    logLevel: "debug",
    slackApiBaseUrl: "https://slack.test/api",
    pingIntervalMs: 30_000,
    pingTimeoutMs: 10_000,
    reconnectMaxDelayMs: 30_000,
    expirationRefreshThresholdSeconds: 300
    ,
    systemEventsAppName: "Slack",
    systemEventsRestoreText: undefined,
    systemEventsRestoreEmoji: undefined
  };
}

function createEvent(classification: "alert" | "early-warning" | "end"): ParsedAlertEvent {
  return {
    classification,
    areas: ["תל אביב - מרכז העיר"],
    normalizedAreas: ["תל אביב - מרכז העיר"],
    title: classification === "end" ? "חזרה לשגרה" : "ירי רקטות וטילים",
    description: "היכנסו למרחב המוגן ושהו בו 10 דקות",
    notificationId: "abc",
    threat: 0,
    isDrill: false,
    dedupeKey: `k:${classification}`,
    source: "websocket",
    raw: {}
  };
}

describe("SlackStatusManager", () => {
  it("saves the previous status and restores it on end", async () => {
    const logger = new Logger("debug");
    const slackClient = new FakeSlackClient();
    const stateStore = new InMemoryStateStore();
    let currentTime = new Date("2026-03-08T12:00:00.000Z");
    const manager = new SlackStatusManager({
      config: createConfig(),
      logger,
      statusClient: slackClient as never,
      stateStore,
      now: () => currentTime
    });

    await manager.initialize();
    await manager.handleActiveEvent(createEvent("alert"));

    expect(slackClient.setCalls).toHaveLength(1);
    expect(slackClient.setCalls[0]?.status_text).toBe("In shelter");
    expect(stateStore.state.savedProfile?.status_text).toBe("Lunch");

    currentTime = new Date("2026-03-08T12:05:00.000Z");
    await manager.handleEndEvent(createEvent("end"));

    expect(slackClient.setCalls).toHaveLength(2);
    expect(slackClient.setCalls[1]).toEqual({
      status_text: "Lunch",
      status_emoji: ":sandwich:",
      status_expiration: 0
    });
    expect(stateStore.state.mode).toBe("idle");
  });
});
