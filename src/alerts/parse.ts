import crypto from "node:crypto";

import { normalizeAreaName } from "../config.js";

export type AlertClassification = "alert" | "early-warning" | "end" | "ignore";

export interface ParsedAlertEvent {
  classification: AlertClassification;
  areas: string[];
  normalizedAreas: string[];
  title: string | undefined;
  description: string | undefined;
  notificationId: string | undefined;
  threat: number | undefined;
  isDrill: boolean;
  dedupeKey: string | null;
  source: "websocket" | "notifications-api" | "unknown";
  raw: unknown;
}

const EARLY_WARNING_PHRASES = [
  "בדקות הקרובות",
  "עדכון",
  "שהייה בסמיכות למרחב מוגן",
  "צפויות להתקבל התרעות",
  "ייתכן ויופעלו התרעות",
  "זיהוי שיגורים",
  "שיגורים לעבר ישראל",
  "בעקבות זיהוי שיגורים"
];

const END_PHRASES = [
  "חזרה לשגרה",
  "האירוע הסתיים",
  "סיום האירוע",
  "סיום התרעה",
  "end",
  "all clear",
  "clear"
];

function standardizeName(name: string): string {
  return normalizeAreaName(name);
}

function flattenPossibleAreas(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      output.push(trimmed);
    }
    return;
  }

  if (typeof value === "number") {
    output.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      flattenPossibleAreas(item, output);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["name", "label", "city", "area", "value", "id"]) {
    flattenPossibleAreas(record[key], output);
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = standardizeName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
}

function extractAreas(payload: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  for (const key of ["cities", "citiesIds", "data", "areas", "area", "regions", "locations", "targets"]) {
    flattenPossibleAreas(payload[key], candidates);
  }

  if (candidates.length === 0) {
    const nestedData = payload.data;
    if (nestedData && typeof nestedData === "object" && !Array.isArray(nestedData)) {
      flattenPossibleAreas(nestedData, candidates);
    }
  }

  return uniqueStrings(candidates);
}

function getTextField(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function textMatches(text: string | undefined, phrases: string[]): boolean {
  if (!text) {
    return false;
  }

  const lowered = text.toLowerCase();
  return phrases.some((phrase) => lowered.includes(phrase.toLowerCase()));
}

function buildDedupeKey(
  payload: Record<string, unknown>,
  classification: AlertClassification,
  normalizedAreas: string[],
  title?: string,
  description?: string
): string | null {
  const notificationId = getTextField(payload, "notificationId", "id");
  if (notificationId) {
    return `${classification}:${notificationId}`;
  }

  if (classification === "ignore") {
    return null;
  }

  const hash = crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        classification,
        normalizedAreas: [...normalizedAreas].sort(),
        title: title ?? "",
        description: description ?? ""
      })
    )
    .digest("hex");

  return `${classification}:${hash}`;
}

function parsePayload(
  payload: Record<string, unknown>,
  source: ParsedAlertEvent["source"]
): ParsedAlertEvent {
  const title = getTextField(
    payload,
    "title",
    "titleHe",
    "titleEn",
    "instruction",
    "message"
  );
  const description = getTextField(
    payload,
    "desc",
    "description",
    "bodyHe",
    "bodyEn",
    "body"
  );
  const outerType = getTextField(payload, "type");
  const areas = extractAreas(payload);
  const normalizedAreas = areas.map(standardizeName);

  let classification: AlertClassification = "ignore";

  if (textMatches(outerType, END_PHRASES) || textMatches(title, END_PHRASES) || textMatches(description, END_PHRASES)) {
    classification = "end";
  } else if (textMatches(title, EARLY_WARNING_PHRASES) || textMatches(description, EARLY_WARNING_PHRASES)) {
    classification = "early-warning";
  } else if (areas.length > 0) {
    classification = "alert";
  }

  const threat =
    typeof payload.threat === "number"
      ? payload.threat
      : Number.isFinite(Number(payload.threat))
        ? Number(payload.threat)
        : undefined;

  return {
    classification,
    areas,
    normalizedAreas,
    title,
    description,
    notificationId: getTextField(payload, "notificationId", "id"),
    threat,
    isDrill: Boolean(payload.isDrill),
    dedupeKey: buildDedupeKey(payload, classification, normalizedAreas, title, description),
    source,
    raw: payload
  };
}

function parseEnvelope(
  envelope: Record<string, unknown>,
  source: ParsedAlertEvent["source"]
): ParsedAlertEvent[] {
  const type = getTextField(envelope, "type");

  if (type === "LISTS_VERSIONS") {
    return [];
  }

  if (type === "ALERT") {
    const payload = envelope.data;
    if (Array.isArray(payload)) {
      return payload
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => parsePayload(item, source));
    }

    if (payload && typeof payload === "object") {
      return [parsePayload(payload as Record<string, unknown>, source)];
    }
  }

  if (type === "SYSTEM_MESSAGE") {
    const payload = envelope.data;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return [parsePayload(payload as Record<string, unknown>, source)];
    }
  }

  return [parsePayload(envelope, source)];
}

export function parseIncomingMessage(
  raw: string | Record<string, unknown> | Array<Record<string, unknown>>,
  source: ParsedAlertEvent["source"] = "unknown"
): ParsedAlertEvent[] {
  if (typeof raw === "string" && raw.trim() === "") {
    return [];
  }

  const parsed =
    typeof raw === "string"
      ? (JSON.parse(raw) as unknown)
      : raw;

  if (Array.isArray(parsed)) {
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .flatMap((item) => parseEnvelope(item, source));
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  return parseEnvelope(parsed as Record<string, unknown>, source);
}

export function hasMatchingArea(
  normalizedConfiguredAreas: ReadonlySet<string>,
  eventNormalizedAreas: string[]
): boolean {
  if (eventNormalizedAreas.length === 0) {
    return false;
  }

  return eventNormalizedAreas.some((area) => normalizedConfiguredAreas.has(area));
}

export function extractDurationSeconds(description: string | undefined): number | null {
  if (!description) {
    return null;
  }

  const minutesMatch = description.match(/(\d+)\s+(?:דקות|דקה|minutes?|minute)/i);
  if (minutesMatch) {
    return Number(minutesMatch[1]) * 60;
  }

  const secondsMatch = description.match(/(\d+)\s+(?:שניות|שניה|seconds?|second)/i);
  if (secondsMatch) {
    return Number(secondsMatch[1]);
  }

  return null;
}
