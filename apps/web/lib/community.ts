export const COMMUNITY_SCHEMA_VERSION = 1 as const;
export const GLOBAL_COMMUNITY_ROOM = "global" as const;
export const COMMUNITY_MESSAGE_LIMIT = 500;
export const COMMUNITY_PRESENCE_HEARTBEAT_MS = 90_000;
export const COMMUNITY_PRESENCE_TTL_MS = 4 * 60_000;

export type CommunityAuthorKind = "guest" | "member" | "creator" | "rmt";

export type CommunityMessage = {
  schemaVersion: typeof COMMUNITY_SCHEMA_VERSION;
  messageId: string;
  roomId: string;
  authorKey: string;
  authorKind: CommunityAuthorKind;
  authorLabel: string;
  authorHandle: string;
  body: string;
  replyTo: string;
  status: "visible";
  createdAt?: unknown;
};

export type CommunityPresence = {
  online: number;
  approximate: true;
  capped: boolean;
  observedAt: string;
};

export function parseCommunityPresence(value: unknown): CommunityPresence | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CommunityPresence>;
  if (
    typeof candidate.online !== "number"
    || !Number.isSafeInteger(candidate.online)
    || candidate.online < 0
    || candidate.online > 1_000
    || candidate.approximate !== true
    || typeof candidate.capped !== "boolean"
    || typeof candidate.observedAt !== "string"
    || !Number.isFinite(Date.parse(candidate.observedAt))
  ) return null;
  return candidate as CommunityPresence;
}

export function normalizeCommunityRoomId(value: unknown) {
  if (value === GLOBAL_COMMUNITY_ROOM) return GLOBAL_COMMUNITY_ROOM;
  if (typeof value !== "string") return "";
  return /^project--[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(value) ? value : "";
}

export function normalizeCommunityBody(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, COMMUNITY_MESSAGE_LIMIT);
}

export function validateCommunityBody(value: unknown, guest: boolean) {
  const body = normalizeCommunityBody(value);
  if (body.length < 2) return "Write at least 2 characters.";
  if (/\b(seed phrase|recovery phrase|private key)\b/i.test(body)) {
    return "Never share wallet recovery words or private keys in RMT Live.";
  }
  if (guest && /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|xyz|fun)\b)/i.test(body)) {
    return "Guest messages cannot include external links.";
  }
  return null;
}

export function parseCommunityMessage(messageId: string, value: unknown): CommunityMessage | null {
  if (!/^[A-Za-z0-9]{20}$/.test(messageId) || !value || typeof value !== "object") return null;
  const candidate = value as CommunityMessage;
  if (
    candidate.schemaVersion !== COMMUNITY_SCHEMA_VERSION
    || candidate.messageId !== messageId
    || !normalizeCommunityRoomId(candidate.roomId)
    || !/^[0-9a-f]{32}$/.test(candidate.authorKey)
    || !["guest", "member", "creator", "rmt"].includes(candidate.authorKind)
    || typeof candidate.authorLabel !== "string"
    || candidate.authorLabel.length < 1
    || candidate.authorLabel.length > 40
    || typeof candidate.authorHandle !== "string"
    || !/^[a-zA-Z0-9_]{0,24}$/.test(candidate.authorHandle)
    || normalizeCommunityBody(candidate.body) !== candidate.body
    || candidate.body.length < 2
    || (candidate.replyTo !== "" && !/^[A-Za-z0-9]{20}$/.test(candidate.replyTo))
    || candidate.status !== "visible"
  ) return null;
  return candidate;
}
