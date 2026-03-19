import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { Logger, type LogLevelName } from "./util/log.js";

export interface AppConfig {
  alertingApproach: "ui" | "slack-app";
  slackToken: string | undefined;
  alertAreas: string[];
  normalizedAlertAreas: Set<string>;
  statusText: string;
  statusEmoji: string;
  statusExpirationSeconds: number;
  wsUrl: string;
  stateFile: string;
  logLevel: LogLevelName;
  configFile: string | undefined;
  slackApiBaseUrl: string;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  reconnectMaxDelayMs: number;
  expirationRefreshThresholdSeconds: number;
  observeOnly: boolean;
  observeAllAreas: boolean;
  alertLogFile: string | undefined;
  systemEventsAppName: string;
  systemEventsStatusTarget: string | undefined;
  systemEventsRestoreText: string | undefined;
  systemEventsRestoreEmoji: string | undefined;
}

interface ConfigFileShape {
  ALERTING_APPROACH?: "ui" | "slack-app";
  SLACK_TOKEN?: string;
  ALERT_AREAS?: string | string[];
  STATUS_TEXT?: string;
  STATUS_EMOJI?: string;
  STATUS_EXPIRATION_SECONDS?: number | string;
  WS_URL?: string;
  STATE_FILE?: string;
  LOG_LEVEL?: LogLevelName;
  SLACK_API_BASE_URL?: string;
  OBSERVE_ONLY?: boolean | string;
  ALERT_LOG_FILE?: string;
  SYSTEM_EVENTS_APP_NAME?: string;
  SYSTEM_EVENTS_STATUS_TARGET?: string;
  SYSTEM_EVENTS_RESTORE_TEXT?: string;
  SYSTEM_EVENTS_RESTORE_EMOJI?: string;
}

const DEFAULT_WS_URL = "wss://ws.tzevaadom.co.il/socket?platform=ANDROID";
const DEFAULT_STATE_FILE = "./state.json";
const DEFAULT_CONFIG_NAMES = ["red-alert-slack.config.json", "config.json"];
const DEFAULT_ALERTING_APPROACH = "ui";
const DEFAULT_STATUS_TEXT = "In shelter";
const DEFAULT_STATUS_EMOJI = ":rotating_light:";
const DEFAULT_STATUS_EXPIRATION_SECONDS = 1800;
const DEFAULT_ALERT_LOG_FILE = "./alerts.log.jsonl";

function normalizeAreaName(name: string): string {
  const trimmed = name.trim();

  if (trimmed === "ג'ת" || trimmed === "ח'וואלד") {
    return trimmed;
  }

  return trimmed.replace(/[\(\)'"]/g, "").replace(/\s+/g, " ").toLowerCase();
}

function parseAreas(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }

  if (typeof raw !== "string") {
    return [];
  }

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseLogLevel(raw: string | undefined): LogLevelName {
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }

  return "info";
}

function parseBoolean(raw: string | boolean | undefined, fallback = false): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw !== "string") {
    return fallback;
  }

  return raw.trim().toLowerCase() === "true";
}

function parseAlertingApproach(raw: string | undefined): "ui" | "slack-app" | undefined {
  if (raw === "ui" || raw === "slack-app") {
    return raw;
  }

  return undefined;
}

function readOptionalConfigFile(): { config?: ConfigFileShape; file?: string } {
  const explicit = process.env.CONFIG_FILE;
  const candidates = explicit ? [explicit] : DEFAULT_CONFIG_NAMES;

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (!fs.existsSync(absolute)) {
      continue;
    }

    const text = fs.readFileSync(absolute, "utf8");
    const parsed = JSON.parse(text) as ConfigFileShape;
    return { config: parsed, file: absolute };
  }

  return {};
}

function readString(
  envValue: string | undefined,
  fileValue: string | undefined,
  name: string,
  required = true
): string {
  const value = envValue ?? fileValue;
  if (!value || !value.trim()) {
    if (required) {
      throw new Error(`Missing required configuration: ${name}`);
    }

    return "";
  }

  return value.trim();
}

function readPositiveInteger(
  envValue: string | undefined,
  fileValue: string | number | undefined,
  name: string
): number {
  const raw = envValue ?? (typeof fileValue === "number" ? String(fileValue) : fileValue);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Configuration ${name} must be a positive integer`);
  }

  return value;
}

export function loadConfig(logger: Logger): AppConfig {
  dotenv.config();

  const { config: fileConfig, file } = readOptionalConfigFile();
  if (file) {
    logger.info("Loaded optional JSON config", { file });
  }

  const observeOnly = parseBoolean(process.env.OBSERVE_ONLY ?? fileConfig?.OBSERVE_ONLY, false);
  const alertingApproach =
    parseAlertingApproach(process.env.ALERTING_APPROACH ?? fileConfig?.ALERTING_APPROACH) ??
    DEFAULT_ALERTING_APPROACH;
  const parsedAlertAreas = parseAreas(process.env.ALERT_AREAS ?? fileConfig?.ALERT_AREAS);
  const observeAllAreas = parsedAlertAreas.length === 0 || parsedAlertAreas.includes("*");
  const alertAreas = observeAllAreas ? [] : parsedAlertAreas;

  if (!observeOnly && alertAreas.length === 0) {
    throw new Error("Missing required configuration: ALERT_AREAS");
  }

  const statusText = readString(
    process.env.STATUS_TEXT,
    fileConfig?.STATUS_TEXT ?? DEFAULT_STATUS_TEXT,
    "STATUS_TEXT"
  );
  if (statusText.length > 100) {
    throw new Error("STATUS_TEXT must be 100 characters or fewer");
  }

  const statusEmoji = readString(
    process.env.STATUS_EMOJI,
    fileConfig?.STATUS_EMOJI ?? DEFAULT_STATUS_EMOJI,
    "STATUS_EMOJI"
  );

  const statusExpirationSeconds = readPositiveInteger(
    process.env.STATUS_EXPIRATION_SECONDS,
    fileConfig?.STATUS_EXPIRATION_SECONDS ?? DEFAULT_STATUS_EXPIRATION_SECONDS,
    "STATUS_EXPIRATION_SECONDS"
  );
  if (!Number.isInteger(statusExpirationSeconds) || statusExpirationSeconds <= 0) {
    throw new Error("Configuration STATUS_EXPIRATION_SECONDS must be a positive integer");
  }

  const logLevel = parseLogLevel(process.env.LOG_LEVEL ?? fileConfig?.LOG_LEVEL);
  const systemEventsStatusTarget =
    process.env.SYSTEM_EVENTS_STATUS_TARGET?.trim() ||
    fileConfig?.SYSTEM_EVENTS_STATUS_TARGET?.trim() ||
    "you";

  return {
    alertingApproach,
    slackToken: observeOnly
      ? process.env.SLACK_TOKEN?.trim() || fileConfig?.SLACK_TOKEN?.trim()
      : alertingApproach === "slack-app"
        ? readString(process.env.SLACK_TOKEN, fileConfig?.SLACK_TOKEN, "SLACK_TOKEN")
        : process.env.SLACK_TOKEN?.trim() || fileConfig?.SLACK_TOKEN?.trim(),
    alertAreas,
    normalizedAlertAreas: new Set(alertAreas.map(normalizeAreaName)),
    statusText,
    statusEmoji,
    statusExpirationSeconds,
    wsUrl: readString(process.env.WS_URL, fileConfig?.WS_URL ?? DEFAULT_WS_URL, "WS_URL"),
    stateFile: path.resolve(
      readString(process.env.STATE_FILE, fileConfig?.STATE_FILE ?? DEFAULT_STATE_FILE, "STATE_FILE")
    ),
    logLevel,
    configFile: file,
    slackApiBaseUrl: readString(
      process.env.SLACK_API_BASE_URL,
      fileConfig?.SLACK_API_BASE_URL ?? "https://slack.com/api",
      "SLACK_API_BASE_URL"
    ),
    pingIntervalMs: 30_000,
    pingTimeoutMs: 10_000,
    reconnectMaxDelayMs: 30_000,
    expirationRefreshThresholdSeconds: Math.max(
      60,
      Math.floor(statusExpirationSeconds / 3)
    ),
    observeOnly,
    observeAllAreas,
    alertLogFile: process.env.ALERT_LOG_FILE
      ? path.resolve(process.env.ALERT_LOG_FILE)
      : fileConfig?.ALERT_LOG_FILE
        ? path.resolve(fileConfig.ALERT_LOG_FILE)
        : path.resolve(DEFAULT_ALERT_LOG_FILE),
    systemEventsAppName: readString(
      process.env.SYSTEM_EVENTS_APP_NAME,
      fileConfig?.SYSTEM_EVENTS_APP_NAME ?? "Slack",
      "SYSTEM_EVENTS_APP_NAME"
    ),
    systemEventsStatusTarget,
    systemEventsRestoreText:
      process.env.SYSTEM_EVENTS_RESTORE_TEXT?.trim() ||
      fileConfig?.SYSTEM_EVENTS_RESTORE_TEXT?.trim(),
    systemEventsRestoreEmoji:
      process.env.SYSTEM_EVENTS_RESTORE_EMOJI?.trim() ||
      fileConfig?.SYSTEM_EVENTS_RESTORE_EMOJI?.trim()
  };
}

export { normalizeAreaName };
