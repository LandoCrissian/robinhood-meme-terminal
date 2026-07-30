import {
  normalizeCommunityBody,
  normalizeCommunityRoomId,
  type CommunityAuthorKind
} from "./community";

export const COMMUNITY_REPORT_REASONS = [
  "spam",
  "scam",
  "harassment",
  "unsafe_link",
  "private_information",
  "other"
] as const;

export type CommunityReportReason = typeof COMMUNITY_REPORT_REASONS[number];

export type AdminCommunityReport = {
  reportId: string;
  roomId: string;
  messageId: string;
  reason: CommunityReportReason;
  authorLabel: string;
  messageBody: string;
  createdAt: string;
};

export type AdminCommunityMessage = {
  messageId: string;
  roomId: string;
  authorKind: CommunityAuthorKind;
  authorLabel: string;
  authorHandle: string;
  messageBody: string;
  createdAt: string;
};

export function normalizeCommunityReportReason(value: unknown): CommunityReportReason | null {
  return typeof value === "string" && COMMUNITY_REPORT_REASONS.includes(value as CommunityReportReason)
    ? value as CommunityReportReason
    : null;
}

export function parseAdminCommunityReport(value: unknown): AdminCommunityReport | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AdminCommunityReport>;
  if (
    typeof candidate.reportId !== "string"
    || !/^[A-Za-z0-9]{20}--[0-9a-f]{32}$/.test(candidate.reportId)
    || typeof candidate.messageId !== "string"
    || !/^[A-Za-z0-9]{20}$/.test(candidate.messageId)
    || !normalizeCommunityRoomId(candidate.roomId)
    || !normalizeCommunityReportReason(candidate.reason)
    || typeof candidate.authorLabel !== "string"
    || candidate.authorLabel.length < 1
    || candidate.authorLabel.length > 40
    || typeof candidate.messageBody !== "string"
    || normalizeCommunityBody(candidate.messageBody) !== candidate.messageBody
    || typeof candidate.createdAt !== "string"
    || !Number.isFinite(Date.parse(candidate.createdAt))
  ) return null;
  return candidate as AdminCommunityReport;
}

export function parseAdminCommunityMessage(value: unknown): AdminCommunityMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AdminCommunityMessage>;
  if (
    typeof candidate.messageId !== "string"
    || !/^[A-Za-z0-9]{20}$/.test(candidate.messageId)
    || !normalizeCommunityRoomId(candidate.roomId)
    || typeof candidate.authorKind !== "string"
    || !["guest", "member", "creator", "rmt"].includes(candidate.authorKind)
    || typeof candidate.authorLabel !== "string"
    || candidate.authorLabel.length < 1
    || candidate.authorLabel.length > 40
    || typeof candidate.authorHandle !== "string"
    || !/^[a-zA-Z0-9_]{0,24}$/.test(candidate.authorHandle)
    || typeof candidate.messageBody !== "string"
    || normalizeCommunityBody(candidate.messageBody) !== candidate.messageBody
    || typeof candidate.createdAt !== "string"
    || !Number.isFinite(Date.parse(candidate.createdAt))
  ) return null;
  return candidate as AdminCommunityMessage;
}
