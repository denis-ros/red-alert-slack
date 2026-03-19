import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Logger } from "../util/log.js";
import type { SlackStatusProfile, StatusClient } from "./client.js";

const execFileAsync = promisify(execFile);

interface SystemEventsStatusClientOptions {
  appName: string;
  statusTarget: string;
  logger: Logger;
  restoreProfile: SlackStatusProfile | null;
}

function buildSlashStatusCommand(profile: SlackStatusProfile): string {
  const parts = ["/status"];

  if (profile.status_emoji) {
    parts.push(profile.status_emoji);
  }

  if (profile.status_text) {
    parts.push(profile.status_text);
  }

  if (profile.status_emoji) {
    parts.push(profile.status_emoji);
  }

  return parts.join(" ");
}

function buildClearStatusCommand(): string {
  return "/status clear";
}

function buildSetStatusScript(
  appName: string,
  statusTarget: string,
  profile: SlackStatusProfile
): string {
  const payload = JSON.stringify({
    appName,
    statusTarget,
    commandText: buildSlashStatusCommand(profile)
  });

  return `
const config = ${payload};

function run() {
  const slack = Application(config.appName);
  slack.activate();
  delay(1.2);

  const systemEvents = Application('System Events');
  systemEvents.keystroke('k', { using: ['command down'] });
  delay(0.8);
  systemEvents.keystroke(config.statusTarget);
  delay(0.8);
  systemEvents.keyCode(36);
  delay(1.2);
  systemEvents.keystroke(config.commandText);
  delay(0.5);
  systemEvents.keyCode(36);
  delay(1);
}

run();
`;
}

function buildClearStatusScript(appName: string, statusTarget: string): string {
  const payload = JSON.stringify({
    appName,
    statusTarget,
    commandText: buildClearStatusCommand()
  });

  return `
const config = ${payload};

function run() {
  const slack = Application(config.appName);
  slack.activate();
  delay(1.2);

  const systemEvents = Application('System Events');
  systemEvents.keystroke('k', { using: ['command down'] });
  delay(0.8);
  systemEvents.keystroke(config.statusTarget);
  delay(0.8);
  systemEvents.keyCode(36);
  delay(1.2);
  systemEvents.keystroke(config.commandText);
  delay(0.5);
  systemEvents.keyCode(36);
  delay(1);
}

run();
`;
}

export class SystemEventsStatusClient implements StatusClient {
  private warnedAboutProfileRead = false;
  private lastActionSignature: string | null = null;
  private lastActionAt = 0;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: SystemEventsStatusClientOptions) {}

  async getProfile(): Promise<SlackStatusProfile> {
    if (!this.warnedAboutProfileRead) {
      this.warnedAboutProfileRead = true;
      this.options.logger.warn(
        "System Events backend cannot reliably read the current Slack status; restore will use the configured fallback profile or clear the status"
      );
    }

    return (
      this.options.restoreProfile ?? {
        status_text: "",
        status_emoji: "",
        status_expiration: 0
      }
    );
  }

  async setProfile(profile: SlackStatusProfile): Promise<void> {
    await this.enqueueOperation(
      `set:${profile.status_text}:${profile.status_emoji}`,
      () => this.runScript(buildSetStatusScript(this.options.appName, this.options.statusTarget, profile))
    );
  }

  async clearStatus(): Promise<void> {
    await this.enqueueOperation(
      "clear",
      () => this.runScript(buildClearStatusScript(this.options.appName, this.options.statusTarget))
    );
  }

  private async runScript(script: string): Promise<void> {
    if (process.platform !== "darwin") {
      throw new Error("System Events backend requires macOS");
    }

    try {
      await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
        timeout: 30_000
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`System Events Slack automation failed: ${message}`);
    }
  }

  private async enqueueOperation(signature: string, action: () => Promise<void>): Promise<void> {
    const now = Date.now();
    if (this.lastActionSignature === signature && now - this.lastActionAt < 15_000) {
      this.options.logger.info("Skipping duplicate Slack UI automation request", { signature });
      return;
    }

    const run = async (): Promise<void> => {
      this.lastActionSignature = signature;
      this.lastActionAt = Date.now();
      await action();
    };

    const next = this.operationQueue.then(run, run);
    this.operationQueue = next.catch(() => undefined);
    await next;
  }
}

export {
  buildClearStatusCommand,
  buildClearStatusScript,
  buildSetStatusScript,
  buildSlashStatusCommand
};
