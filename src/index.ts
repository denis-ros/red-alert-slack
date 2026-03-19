import { loadConfig } from "./config.js";
import { AlertWebsocketClient } from "./alerts/client.js";
import { CityCatalog } from "./alerts/cities.js";
import { MessageDeduper } from "./alerts/dedupe.js";
import { hasMatchingArea, parseIncomingMessage } from "./alerts/parse.js";
import type { StatusClient } from "./slack/client.js";
import { SlackClient } from "./slack/client.js";
import { SystemEventsStatusClient } from "./slack/system-events.js";
import { SlackStatusManager } from "./slack/status.js";
import { JsonStateStore } from "./state/store.js";
import { EventLogWriter } from "./util/event-log.js";
import { Logger } from "./util/log.js";

function hasCliFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main(): Promise<void> {
  const isTestMode = hasCliFlag("--test");
  const bootstrapLogger = new Logger(process.env.LOG_LEVEL === "debug" ? "debug" : "info");
  const config = loadConfig(bootstrapLogger);
  const logger = new Logger(config.logLevel);

  let statusManager: SlackStatusManager | null = null;
  let statusClient: StatusClient | null = null;

  if (!config.observeOnly) {
    if (config.alertingApproach === "ui") {
      logger.info("Using System Events Slack backend", {
        appName: config.systemEventsAppName,
        statusTarget: config.systemEventsStatusTarget
      });
      statusClient = new SystemEventsStatusClient({
        appName: config.systemEventsAppName,
        statusTarget: config.systemEventsStatusTarget!,
        logger,
        restoreProfile:
          config.systemEventsRestoreText || config.systemEventsRestoreEmoji
            ? {
                status_text: config.systemEventsRestoreText ?? "",
                status_emoji: config.systemEventsRestoreEmoji ?? "",
                status_expiration: 0
              }
            : null
      });
    } else {
      const slackClient = new SlackClient({
        token: config.slackToken!,
        logger,
        apiBaseUrl: config.slackApiBaseUrl
      });

      const startupProfile = await slackClient.getProfile();
      logger.info("Slack auth self-check passed", {
        hasStatusText: Boolean(startupProfile.status_text),
        hasStatusEmoji: Boolean(startupProfile.status_emoji)
      });
      statusClient = slackClient;
    }

    if (isTestMode) {
      logger.info("Running one-shot Slack status test");
      await statusClient.setProfile({
        status_text: "test status",
        status_emoji: config.statusEmoji,
        status_expiration: 0
      });
      logger.info("Slack status test completed");
      return;
    }

    const eventLogWriter = new EventLogWriter(config.alertLogFile);
    const deduper = new MessageDeduper();
    const stateStore = new JsonStateStore(config.stateFile);
    const cityCatalog = await CityCatalog.load(logger);
    const configuredAreaIds =
      cityCatalog?.resolveConfiguredAreaIds(config.alertAreas) ?? new Set<string>();

    statusManager = new SlackStatusManager({
      config,
      logger,
      statusClient,
      stateStore
    });
    await statusManager.initialize();

    const websocketClient = new AlertWebsocketClient({
      url: config.wsUrl,
      origin: "https://www.tzevaadom.co.il",
      logger,
      pingIntervalMs: config.pingIntervalMs,
      pingTimeoutMs: config.pingTimeoutMs,
      reconnectMaxDelayMs: config.reconnectMaxDelayMs,
      onMessage: async (message) => {
        const events = parseIncomingMessage(message, "websocket");

        for (const event of events) {
          if (event.classification === "ignore") {
            logger.debug("Ignoring non-alert message");
            continue;
          }

          if (cityCatalog) {
            const resolvedAreas = cityCatalog.resolveAreas(event.areas);
            event.areas = resolvedAreas;
            event.normalizedAreas = resolvedAreas.map((area) =>
              area.trim().replace(/[\(\)'"]/g, "").replace(/\s+/g, " ").toLowerCase()
            );
          }

          const matchesConfiguredArea =
            config.observeAllAreas ||
            hasMatchingArea(config.normalizedAlertAreas, event.normalizedAreas) ||
            event.areas.some((area) => configuredAreaIds.has(area));

          if (!matchesConfiguredArea) {
            logger.debug("Alert did not match configured areas", {
              eventAreas: event.areas,
              configuredAreas: config.alertAreas
            });
            continue;
          }

          if (event.dedupeKey && deduper.hasSeen(event.dedupeKey)) {
            logger.debug("Dropping duplicate alert event", { dedupeKey: event.dedupeKey });
            continue;
          }

          logger.info("Processing matching alert event", {
            classification: event.classification,
            areas: event.areas,
            title: event.title
          });
          await eventLogWriter.write(event);

          if (!statusManager) {
            continue;
          }

          if (event.classification === "end") {
            await statusManager.handleEndEvent(event);
            continue;
          }

          await statusManager.handleActiveEvent(event);
        }
      }
    });

    websocketClient.start();

    const handleShutdown = async (signal: string): Promise<void> => {
      logger.info("Received shutdown signal", { signal });
      await websocketClient.stop();
      await statusManager?.shutdown();
      process.exit(0);
    };

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        void handleShutdown(signal);
      });
    }
  } else {
    logger.info("Starting in observe-only mode", {
      observeAllAreas: config.observeAllAreas,
      alertLogFile: config.alertLogFile
    });
    if (isTestMode) {
      logger.info("Test mode requested in observe-only mode; no Slack status will be changed");
      return;
    }

    const eventLogWriter = new EventLogWriter(config.alertLogFile);
    const deduper = new MessageDeduper();
    const cityCatalog = await CityCatalog.load(logger);
    const configuredAreaIds =
      cityCatalog?.resolveConfiguredAreaIds(config.alertAreas) ?? new Set<string>();

    const websocketClient = new AlertWebsocketClient({
      url: config.wsUrl,
      origin: "https://www.tzevaadom.co.il",
      logger,
      pingIntervalMs: config.pingIntervalMs,
      pingTimeoutMs: config.pingTimeoutMs,
      reconnectMaxDelayMs: config.reconnectMaxDelayMs,
      onMessage: async (message) => {
        const events = parseIncomingMessage(message, "websocket");

        for (const event of events) {
          if (event.classification === "ignore") {
            logger.debug("Ignoring non-alert message");
            continue;
          }

          if (cityCatalog) {
            const resolvedAreas = cityCatalog.resolveAreas(event.areas);
            event.areas = resolvedAreas;
            event.normalizedAreas = resolvedAreas.map((area) =>
              area.trim().replace(/[\(\)'"]/g, "").replace(/\s+/g, " ").toLowerCase()
            );
          }

          const matchesConfiguredArea =
            config.observeAllAreas ||
            hasMatchingArea(config.normalizedAlertAreas, event.normalizedAreas) ||
            event.areas.some((area) => configuredAreaIds.has(area));

          if (!matchesConfiguredArea) {
            logger.debug("Alert did not match configured areas", {
              eventAreas: event.areas,
              configuredAreas: config.alertAreas
            });
            continue;
          }

          if (event.dedupeKey && deduper.hasSeen(event.dedupeKey)) {
            logger.debug("Dropping duplicate alert event", { dedupeKey: event.dedupeKey });
            continue;
          }

          logger.info("Processing matching alert event", {
            classification: event.classification,
            areas: event.areas,
            title: event.title
          });
          await eventLogWriter.write(event);
        }
      }
    });

    websocketClient.start();

    const handleShutdown = async (signal: string): Promise<void> => {
      logger.info("Received shutdown signal", { signal });
      await websocketClient.stop();
      process.exit(0);
    };

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        void handleShutdown(signal);
      });
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${new Date().toISOString()} ERROR Fatal startup failure ${message}`);
  process.exit(1);
});
