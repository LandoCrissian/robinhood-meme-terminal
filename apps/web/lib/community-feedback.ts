export const COMMUNITY_FEEDBACK_CATEGORIES = [
  "bug",
  "feature",
  "mobile",
  "trading",
  "market_data",
  "creator_tools",
  "other"
] as const;

export const COMMUNITY_FEEDBACK_STATUSES = [
  "submitted",
  "under_review",
  "planned",
  "shipped",
  "closed"
] as const;

export type CommunityFeedbackCategory = typeof COMMUNITY_FEEDBACK_CATEGORIES[number];
export type CommunityFeedbackStatus = typeof COMMUNITY_FEEDBACK_STATUSES[number];

export type AdminCommunityFeedback = {
  feedbackId: string;
  category: CommunityFeedbackCategory;
  title: string;
  description: string;
  identityKind: "guest" | "member";
  status: CommunityFeedbackStatus;
  reviewNote: string;
  createdAt: string;
};

export function normalizeCommunityFeedbackCategory(value: unknown): CommunityFeedbackCategory | null {
  return typeof value === "string" && COMMUNITY_FEEDBACK_CATEGORIES.includes(value as CommunityFeedbackCategory)
    ? value as CommunityFeedbackCategory
    : null;
}

export function normalizeCommunityFeedbackTitle(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function normalizeCommunityFeedbackDescription(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

export function normalizeCommunityFeedbackStatus(value: unknown): CommunityFeedbackStatus | null {
  return typeof value === "string" && COMMUNITY_FEEDBACK_STATUSES.includes(value as CommunityFeedbackStatus)
    ? value as CommunityFeedbackStatus
    : null;
}

export function validateCommunityFeedbackContent(title: string, description: string, guest: boolean) {
  const combined = `${title} ${description}`;
  if (/\b(seed phrase|recovery phrase|private key)\b/i.test(combined)) {
    return "Never share wallet recovery words or private keys in RMT feedback.";
  }
  if (guest && /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|xyz|fun)\b)/i.test(combined)) {
    return "Guest feedback cannot include external links.";
  }
  return null;
}

export function parseAdminCommunityFeedback(value: unknown): AdminCommunityFeedback | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AdminCommunityFeedback>;
  if (
    typeof candidate.feedbackId !== "string"
    || !/^[A-Za-z0-9]{20}$/.test(candidate.feedbackId)
    || !normalizeCommunityFeedbackCategory(candidate.category)
    || normalizeCommunityFeedbackTitle(candidate.title) !== candidate.title
    || candidate.title.length < 4
    || normalizeCommunityFeedbackDescription(candidate.description) !== candidate.description
    || candidate.description.length < 10
    || (candidate.identityKind !== "guest" && candidate.identityKind !== "member")
    || !normalizeCommunityFeedbackStatus(candidate.status)
    || typeof candidate.reviewNote !== "string"
    || candidate.reviewNote.length > 240
    || typeof candidate.createdAt !== "string"
    || !Number.isFinite(Date.parse(candidate.createdAt))
  ) return null;
  return candidate as AdminCommunityFeedback;
}
