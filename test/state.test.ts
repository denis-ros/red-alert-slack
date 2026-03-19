import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_STATE, JsonStateStore } from "../src/state/store.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
});

describe("JsonStateStore", () => {
  it("round-trips persisted state", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "red-alert-slack-"));
    createdDirs.push(directory);
    const store = new JsonStateStore(path.join(directory, "state.json"));

    const state = {
      ...EMPTY_STATE,
      mode: "alert-active" as const,
      desiredProfile: {
        status_text: "In shelter",
        status_emoji: ":rotating_light:",
        status_expiration: 1234
      },
      activeEvent: {
        classification: "alert" as const,
        areas: ["תל אביב - מרכז העיר"],
        startedAt: "2026-03-08T10:00:00.000Z",
        lastEventAt: "2026-03-08T10:00:00.000Z",
        expiresAt: "2026-03-08T10:15:00.000Z"
      }
    };

    await store.save(state);
    const loaded = await store.load();

    expect(loaded).toEqual(state);
  });
});

