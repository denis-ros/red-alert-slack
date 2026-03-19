import fs from "node:fs/promises";
import path from "node:path";

import type { ParsedAlertEvent } from "../alerts/parse.js";

export class EventLogWriter {
  constructor(private readonly file: string | undefined) {}

  async write(event: ParsedAlertEvent): Promise<void> {
    if (!this.file) {
      return;
    }

    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const line = JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        classification: event.classification,
        areas: event.areas,
        title: event.title,
        description: event.description,
        notificationId: event.notificationId,
        threat: event.threat,
        isDrill: event.isDrill,
        source: event.source
      }
    );
    await fs.appendFile(this.file, `${line}\n`, "utf8");
  }
}

