import { describe, expect, it } from "vitest";

import {
  buildClearStatusCommand,
  buildClearStatusScript,
  buildSlashStatusCommand,
  buildSetStatusScript
} from "../src/slack/system-events.js";

describe("System Events Slack backend", () => {
  it("builds a slash command with emoji and status text", () => {
    expect(
      buildSlashStatusCommand({
        status_text: "In shelter",
        status_emoji: ":rotating_light:",
        status_expiration: 0
      })
    ).toBe("/status :rotating_light: In shelter :rotating_light:");
  });

  it("builds the clear-status slash command", () => {
    expect(buildClearStatusCommand()).toBe("/status clear");
  });

  it("builds a set-status script with app and status payload", () => {
    const script = buildSetStatusScript("Slack", "you", {
      status_text: "In shelter",
      status_emoji: ":rotating_light:",
      status_expiration: 0
    });

    expect(script).toContain('"appName":"Slack"');
    expect(script).toContain('"statusTarget":"you"');
    expect(script).toContain('"/status :rotating_light: In shelter :rotating_light:"');
    expect(script).toContain("keystroke('k', { using: ['command down'] })");
    expect(script).toContain("keystroke(config.commandText)");
    expect(script).toContain("systemEvents.keyCode(36);");
  });

  it("builds a clear-status script for the target app", () => {
    const script = buildClearStatusScript("Slack", "you");
    expect(script).toContain('"appName":"Slack"');
    expect(script).toContain('"statusTarget":"you"');
    expect(script).toContain('"/status clear"');
    expect(script).toContain("keystroke('k', { using: ['command down'] })");
    expect(script).toContain("keystroke(config.commandText)");
    expect(script).toContain("keyCode(36)");
  });
});
