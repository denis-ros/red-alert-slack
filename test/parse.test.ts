import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractDurationSeconds,
  hasMatchingArea,
  parseIncomingMessage
} from "../src/alerts/parse.js";
import { normalizeAreaName } from "../src/config.js";

function loadFixture(name: string): string {
  return fs.readFileSync(
    path.resolve("test/fixtures/websocket-messages", name),
    "utf8"
  );
}

describe("parseIncomingMessage", () => {
  it("parses current Tzeva Adom websocket alert envelopes", () => {
    const [event] = parseIncomingMessage(loadFixture("alert.json"), "websocket");

    expect(event.classification).toBe("alert");
    expect(event.notificationId).toBe("alert-123");
    expect(event.areas).toEqual(["תל אביב - מרכז העיר", "חיפה - מפרץ"]);
    expect(hasMatchingArea(new Set([normalizeAreaName("חיפה - מפרץ")]), event.normalizedAreas)).toBe(true);
  });

  it("classifies early warning alerts using Oref title patterns", () => {
    const [event] = parseIncomingMessage(loadFixture("early-warning.json"), "websocket");

    expect(event.classification).toBe("early-warning");
    expect(extractDurationSeconds(event.description)).toBe(600);
  });

  it("classifies explicit end payloads when an end phrase is present", () => {
    const [event] = parseIncomingMessage(loadFixture("end.synthetic.json"), "websocket");

    expect(event.classification).toBe("end");
    expect(event.areas).toEqual(["תל אביב - מרכז העיר"]);
  });

  it("classifies Android system early-warning messages", () => {
    const [event] = parseIncomingMessage(loadFixture("system-message-early-warning.json"), "websocket");

    expect(event.classification).toBe("early-warning");
    expect(event.areas).toEqual(["305"]);
  });

  it("classifies Android system exit notifications", () => {
    const [event] = parseIncomingMessage(loadFixture("system-message-end.json"), "websocket");

    expect(event.classification).toBe("end");
    expect(event.areas).toEqual(["305"]);
  });
});
