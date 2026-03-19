import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { Logger } from "../src/util/log.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
  it("supports a minimal ui configuration with only ALERT_AREAS", () => {
    const originalCwd = process.cwd();
    process.env.OBSERVE_ONLY = "false";
    process.env.ALERT_AREAS = "קריית ביאליק";
    delete process.env.ALERT_LOG_FILE;
    delete process.env.ALERTING_APPROACH;
    delete process.env.STATUS_TEXT;
    delete process.env.STATUS_EMOJI;
    delete process.env.STATUS_EXPIRATION_SECONDS;
    delete process.env.SYSTEM_EVENTS_STATUS_TARGET;
    process.chdir("/tmp");

    try {
      const config = loadConfig(new Logger("error"));

      expect(config.alertingApproach).toBe("ui");
      expect(config.statusText).toBe("In shelter");
      expect(config.statusEmoji).toBe(":rotating_light:");
      expect(config.statusExpirationSeconds).toBe(1800);
      expect(config.alertLogFile).toMatch(/\/tmp\/alerts\.log\.jsonl$/);
      expect(config.systemEventsStatusTarget).toBe("you");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("maps ALERTING_APPROACH=ui to the System Events backend", () => {
    process.env.OBSERVE_ONLY = "false";
    process.env.ALERTING_APPROACH = "ui";
    process.env.ALERT_AREAS = "קריית ביאליק";
    process.env.STATUS_TEXT = "In shelter";
    process.env.STATUS_EMOJI = ":rotating_light:";
    process.env.STATUS_EXPIRATION_SECONDS = "900";

    const config = loadConfig(new Logger("error"));

    expect(config.alertingApproach).toBe("ui");
    expect(config.systemEventsStatusTarget).toBe("you");
  });

  it("maps ALERTING_APPROACH=slack-app to the Slack API backend", () => {
    process.env.OBSERVE_ONLY = "false";
    process.env.ALERTING_APPROACH = "slack-app";
    process.env.SLACK_TOKEN = "xoxp-test";
    process.env.ALERT_AREAS = "קריית ביאליק";
    process.env.STATUS_TEXT = "In shelter";
    process.env.STATUS_EMOJI = ":rotating_light:";
    process.env.STATUS_EXPIRATION_SECONDS = "900";

    const config = loadConfig(new Logger("error"));

    expect(config.alertingApproach).toBe("slack-app");
  });
});
