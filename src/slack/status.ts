import type { AppConfig } from "../config.js";
import type { ParsedAlertEvent } from "../alerts/parse.js";
import { extractDurationSeconds } from "../alerts/parse.js";
import { normalizeAreaName } from "../config.js";
import { Logger } from "../util/log.js";
import { boundedBackoffDelay, nowUnixSeconds, sleep } from "../util/time.js";
import type { SlackStatusProfile, StatusClient } from "./client.js";
import { SlackApiError } from "./client.js";
import { EMPTY_STATE, type PersistedState, type StateStore } from "../state/store.js";

interface StatusManagerOptions {
  config: AppConfig;
  logger: Logger;
  statusClient: StatusClient;
  stateStore: StateStore;
  now?: () => Date;
}

function hasNonEmptyStatus(profile: SlackStatusProfile | null): boolean {
  if (!profile) {
    return false;
  }

  return Boolean(profile.status_text || profile.status_emoji || profile.status_expiration);
}

function profilesEqual(a: SlackStatusProfile | null, b: SlackStatusProfile | null): boolean {
  if (!a || !b) {
    return a === b;
  }

  return (
    a.status_text === b.status_text &&
    a.status_emoji === b.status_emoji &&
    a.status_expiration === b.status_expiration
  );
}

export class SlackStatusManager {
  private state: PersistedState = { ...EMPTY_STATE };
  private expirationTimer: NodeJS.Timeout | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: StatusManagerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    this.state = await this.options.stateStore.load();

    if (this.state.mode !== "alert-active" || !this.state.activeEvent) {
      return;
    }

    const expiresAt = new Date(this.state.activeEvent.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= this.now().getTime()) {
      this.options.logger.info("Persisted alert state already expired, restoring immediately");
      await this.restoreOrClear("startup-expired");
      return;
    }

    this.options.logger.info("Recovered active alert state from disk", {
      expiresAt: this.state.activeEvent.expiresAt
    });

    await this.ensureDesiredStatus();
    this.scheduleExpiration(expiresAt);
  }

  async handleActiveEvent(event: ParsedAlertEvent): Promise<void> {
    const ttlSeconds = this.pickTtlSeconds(event);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const desiredProfile: SlackStatusProfile = {
      status_text: this.options.config.statusText,
      status_emoji: this.options.config.statusEmoji,
      status_expiration: nowUnixSeconds(expiresAt)
    };

    if (this.state.mode === "idle") {
      const currentProfile = await this.withSlackRetry(() => this.options.statusClient.getProfile());
      const savedProfile = profilesEqual(currentProfile, desiredProfile) ? null : currentProfile;

      if (!profilesEqual(currentProfile, desiredProfile)) {
        await this.withSlackRetry(() => this.options.statusClient.setProfile(desiredProfile));
      } else {
        this.options.logger.info("Slack already has the desired emergency status");
      }

      this.state = {
        version: 1,
        mode: "alert-active",
        savedProfile,
        desiredProfile,
        activeEvent: {
          classification: this.toActiveClassification(event.classification),
          areas: event.areas,
          startedAt: now.toISOString(),
          lastEventAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          title: event.title,
          description: event.description
        }
      };

      await this.persistState();
      this.scheduleExpiration(expiresAt);
      return;
    }

    const remainingSeconds =
      this.state.desiredProfile?.status_expiration !== undefined
        ? this.state.desiredProfile.status_expiration - nowUnixSeconds(now)
        : 0;
    const shouldRefresh = remainingSeconds <= this.options.config.expirationRefreshThresholdSeconds;

    if (shouldRefresh && !profilesEqual(this.state.desiredProfile, desiredProfile)) {
      await this.withSlackRetry(() => this.options.statusClient.setProfile(desiredProfile));
    } else if (shouldRefresh) {
      await this.withSlackRetry(() => this.options.statusClient.setProfile(desiredProfile));
    }

    this.state = {
      ...this.state,
      desiredProfile,
      activeEvent: {
        classification: this.toActiveClassification(event.classification),
        areas: event.areas,
        startedAt: this.state.activeEvent?.startedAt ?? now.toISOString(),
        lastEventAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        title: event.title,
        description: event.description
      }
    };

    await this.persistState();
    this.scheduleExpiration(expiresAt);
  }

  async handleEndEvent(event: ParsedAlertEvent): Promise<void> {
    if (this.state.mode !== "alert-active") {
      return;
    }

    if (
      event.normalizedAreas.length > 0 &&
      this.state.activeEvent?.areas.length &&
      !event.normalizedAreas.some((area) =>
        this.state.activeEvent?.areas.some((activeArea) => area === normalizeAreaName(activeArea))
      )
    ) {
      this.options.logger.debug("Ignoring end event for non-active areas", {
        eventAreas: event.areas,
        activeAreas: this.state.activeEvent?.areas
      });
      return;
    }

    this.options.logger.info("Received matching end event, restoring Slack status", {
      areas: event.areas
    });
    await this.restoreOrClear("explicit-end");
  }

  async shutdown(): Promise<void> {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }
  }

  private pickTtlSeconds(event: ParsedAlertEvent): number {
    const extracted = extractDurationSeconds(event.description);
    if (!extracted) {
      return this.options.config.statusExpirationSeconds;
    }

    return Math.max(extracted, this.options.config.statusExpirationSeconds);
  }

  private async ensureDesiredStatus(): Promise<void> {
    if (!this.state.desiredProfile) {
      return;
    }

    const desiredProfile = this.state.desiredProfile;
    const currentProfile = await this.withSlackRetry(() => this.options.statusClient.getProfile());
    if (profilesEqual(currentProfile, desiredProfile)) {
      return;
    }

    await this.withSlackRetry(() => this.options.statusClient.setProfile(desiredProfile));
  }

  private scheduleExpiration(expiresAt: Date): void {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }

    const delayMs = Math.max(expiresAt.getTime() - this.now().getTime(), 0);
    this.expirationTimer = setTimeout(() => {
      void this.restoreOrClear("ttl-expired");
    }, delayMs);
  }

  private async restoreOrClear(reason: string): Promise<void> {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }

    if (hasNonEmptyStatus(this.state.savedProfile)) {
      const savedProfile = this.state.savedProfile!;
      await this.withSlackRetry(() => this.options.statusClient.setProfile(savedProfile));
    } else {
      await this.withSlackRetry(() => this.options.statusClient.clearStatus());
    }

    this.options.logger.info("Slack status restored or cleared", { reason });
    this.state = { ...EMPTY_STATE };
    await this.persistState();
  }

  private async persistState(): Promise<void> {
    await this.options.stateStore.save(this.state);
  }

  private async withSlackRetry<T>(action: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        lastError = error;

        if (error instanceof SlackApiError) {
          if (
            error.code === "invalid_auth" ||
            error.code === "missing_scope" ||
            error.code?.includes("policy")
          ) {
            throw error;
          }
        }

        const delayMs = boundedBackoffDelay(attempt, 5_000);
        this.options.logger.warn("Slack API call failed, retrying", {
          attempt: attempt + 1,
          delayMs,
          error: error instanceof Error ? error.message : String(error)
        });
        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  private toActiveClassification(
    classification: ParsedAlertEvent["classification"]
  ): "alert" | "early-warning" {
    return classification === "early-warning" ? "early-warning" : "alert";
  }
}
