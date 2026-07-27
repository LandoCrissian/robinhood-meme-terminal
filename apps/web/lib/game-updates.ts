import { cleanProjectMediaUri } from "./creator-application";

export const GAME_UPDATE_SCHEMA_VERSION = 1 as const;
export const GAME_UPDATE_TYPES = ["development", "milestone", "playtest", "release"] as const;

export type GameUpdateType = typeof GAME_UPDATE_TYPES[number];

export type GameUpdateDraft = {
  type: GameUpdateType;
  title: string;
  body: string;
  version: string;
  link: string;
  imageUri: string;
};

export type GameUpdate = GameUpdateDraft & {
  schemaVersion: typeof GAME_UPDATE_SCHEMA_VERSION;
  id: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const EMPTY_GAME_UPDATE: GameUpdateDraft = {
  type: "development",
  title: "",
  body: "",
  version: "",
  link: "",
  imageUri: ""
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanHttpsUrl(value: unknown) {
  const candidate = cleanText(value, 256);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString().slice(0, 256)
      : "";
  } catch {
    return "";
  }
}

export function normalizeGameUpdate(value: unknown): GameUpdateDraft {
  const draft = value && typeof value === "object" ? value as Partial<GameUpdateDraft> : {};
  return {
    type: GAME_UPDATE_TYPES.includes(draft.type as GameUpdateType)
      ? draft.type as GameUpdateType
      : "development",
    title: cleanText(draft.title, 80),
    body: cleanText(draft.body, 600),
    version: cleanText(draft.version, 24),
    link: cleanHttpsUrl(draft.link),
    imageUri: cleanProjectMediaUri(draft.imageUri)
  };
}

export function validateGameUpdate(value: GameUpdateDraft) {
  const draft = normalizeGameUpdate(value);
  if (draft.title.length < 4) return "Update title must be at least 4 characters.";
  if (draft.body.length < 20) return "Update details must be at least 20 characters.";
  if (value.link.trim() && !draft.link) return "Update link must be a valid HTTPS URL.";
  if (value.imageUri.trim() && !draft.imageUri) {
    return "Update artwork must be a valid HTTPS or IPFS image URL. SVG files are not accepted.";
  }
  return null;
}

export function parseGameUpdate(id: string, value: unknown): GameUpdate | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<GameUpdate>;
  const draft = normalizeGameUpdate(data);
  if (
    data.schemaVersion !== GAME_UPDATE_SCHEMA_VERSION
    || !id
    || validateGameUpdate(draft)
  ) return null;
  return {
    ...draft,
    schemaVersion: GAME_UPDATE_SCHEMA_VERSION,
    id,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

export function gameUpdateTime(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  if ("toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}
