import fs from "node:fs/promises";
import path from "node:path";

import type { SlackStatusProfile } from "../slack/client.js";

export interface PersistedState {
  version: 1;
  mode: "idle" | "alert-active";
  savedProfile: SlackStatusProfile | null;
  desiredProfile: SlackStatusProfile | null;
  activeEvent: {
    classification: "alert" | "early-warning";
    areas: string[];
    startedAt: string;
    lastEventAt: string;
    expiresAt: string;
    title: string | undefined;
    description: string | undefined;
  } | null;
}

export interface StateStore {
  load(): Promise<PersistedState>;
  save(state: PersistedState): Promise<void>;
}

export const EMPTY_STATE: PersistedState = {
  version: 1,
  mode: "idle",
  savedProfile: null,
  desiredProfile: null,
  activeEvent: null
};

export class JsonStateStore implements StateStore {
  constructor(private readonly file: string) {}

  async load(): Promise<PersistedState> {
    try {
      const text = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(text) as PersistedState;
      if (parsed.version !== 1) {
        return { ...EMPTY_STATE };
      }

      return {
        ...EMPTY_STATE,
        ...parsed
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { ...EMPTY_STATE };
      }

      throw error;
    }
  }

  async save(state: PersistedState): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tempFile = `${this.file}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempFile, this.file);
  }
}
