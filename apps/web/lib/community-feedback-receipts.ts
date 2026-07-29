const STORAGE_KEY = "rmt-community-feedback-receipts-v1";
const FEEDBACK_ID = /^[A-Za-z0-9]{20}$/;
const MAX_RECEIPTS = 12;

type ReceiptStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeCommunityFeedbackReceiptIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && FEEDBACK_ID.test(item)) unique.add(item);
    if (unique.size === MAX_RECEIPTS) break;
  }
  return [...unique];
}

export function readCommunityFeedbackReceiptIds(storage?: ReceiptStorage) {
  const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!target) return [];
  try {
    return normalizeCommunityFeedbackReceiptIds(JSON.parse(target.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function rememberCommunityFeedbackReceipt(feedbackId: string, storage?: ReceiptStorage) {
  const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!target || !FEEDBACK_ID.test(feedbackId)) return readCommunityFeedbackReceiptIds(target ?? undefined);
  const next = normalizeCommunityFeedbackReceiptIds([
    feedbackId,
    ...readCommunityFeedbackReceiptIds(target)
  ]);
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return readCommunityFeedbackReceiptIds(target);
  }
  return next;
}

export function forgetCommunityFeedbackReceipt(feedbackId: string, storage?: ReceiptStorage) {
  const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!target) return [];
  const next = readCommunityFeedbackReceiptIds(target).filter((item) => item !== feedbackId);
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return readCommunityFeedbackReceiptIds(target);
  }
  return next;
}
