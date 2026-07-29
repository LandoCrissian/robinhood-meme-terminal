import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMUNITY_PRESENCE_HEARTBEAT_MS,
  COMMUNITY_PRESENCE_TTL_MS,
  normalizeCommunityBody,
  normalizeCommunityRoomId,
  parseCommunityMessage,
  parseCommunityPresence,
  validateCommunityBody
} from "./community";
import {
  normalizeCommunityReportReason,
  parseAdminCommunityReport
} from "./community-moderation";
import {
  normalizeCommunityFeedbackCategory,
  normalizeCommunityFeedbackDescription,
  normalizeCommunityFeedbackTitle,
  parseAdminCommunityFeedback,
  parsePublicCommunityFeedbackStatus,
  validateCommunityFeedbackContent
} from "./community-feedback";
import {
  forgetCommunityFeedbackReceipt,
  normalizeCommunityFeedbackReceiptIds,
  readCommunityFeedbackReceiptIds,
  rememberCommunityFeedbackReceipt
} from "./community-feedback-receipts";

assert.equal(normalizeCommunityRoomId("global"), "global");
assert.equal(normalizeCommunityRoomId("project--rmt-studio"), "project--rmt-studio");
assert.equal(normalizeCommunityRoomId("project--../../admin"), "");
assert.equal(normalizeCommunityBody("  Hello\n\nRMT  "), "Hello RMT");
assert.match(validateCommunityBody("https://malicious.example", true) ?? "", /cannot include external links/);
assert.match(validateCommunityBody("my private key is abc", false) ?? "", /Never share/);
assert.equal(validateCommunityBody("Watching the RMT curve markets today.", true), null);

const message = {
  schemaVersion: 1,
  messageId: "AbCdEfGhIjKlMnOpQrSt",
  roomId: "global",
  authorKey: "1234567890abcdef1234567890abcdef",
  authorKind: "guest",
  authorLabel: "Guest-CDEF",
  authorHandle: "",
  body: "Watching the RMT curve markets today.",
  replyTo: "",
  status: "visible"
} as const;
assert.deepEqual(parseCommunityMessage(message.messageId, message), message);
assert.equal(parseCommunityMessage(message.messageId, { ...message, authorKind: "rmt", authorLabel: "" }), null);
assert.equal(parseCommunityMessage(message.messageId, { ...message, status: "moderated" }), null);
assert.ok(COMMUNITY_PRESENCE_TTL_MS > COMMUNITY_PRESENCE_HEARTBEAT_MS * 2);
assert.deepEqual(parseCommunityPresence({
  online: 12,
  approximate: true,
  capped: false,
  observedAt: "2026-07-29T12:00:00.000Z"
}), {
  online: 12,
  approximate: true,
  capped: false,
  observedAt: "2026-07-29T12:00:00.000Z"
});
assert.equal(parseCommunityPresence({
  online: 12,
  approximate: false,
  capped: false,
  observedAt: "2026-07-29T12:00:00.000Z"
}), null);
assert.equal(normalizeCommunityReportReason("scam"), "scam");
assert.equal(normalizeCommunityReportReason("disagreement"), null);
assert.ok(parseAdminCommunityReport({
  reportId: "AbCdEfGhIjKlMnOpQrSt--1234567890abcdef1234567890abcdef",
  roomId: "global",
  messageId: "AbCdEfGhIjKlMnOpQrSt",
  reason: "scam",
  authorLabel: "Guest-CDEF",
  messageBody: "Watching the RMT curve markets today.",
  createdAt: "2026-07-29T12:00:00.000Z"
}));
assert.equal(normalizeCommunityFeedbackCategory("mobile"), "mobile");
assert.equal(normalizeCommunityFeedbackCategory("investment_advice"), null);
assert.equal(normalizeCommunityFeedbackTitle("  Better   charts  "), "Better charts");
assert.equal(normalizeCommunityFeedbackDescription("  Expected\n\none tap  "), "Expected one tap");
assert.match(validateCommunityFeedbackContent("Wallet issue", "my recovery phrase is", false) ?? "", /Never share/);
assert.match(validateCommunityFeedbackContent("Bug", "See https://unsafe.example", true) ?? "", /cannot include external links/);
assert.equal(validateCommunityFeedbackContent("Mobile spacing", "Buttons are too close together.", true), null);
assert.ok(parseAdminCommunityFeedback({
  feedbackId: "LmNoPqRsTuVwXyZaBcDe",
  category: "mobile",
  title: "Improve mobile spacing",
  description: "The trade ticket needs more thumb spacing.",
  identityKind: "guest",
  status: "submitted",
  reviewNote: "",
  createdAt: "2026-07-29T12:00:00.000Z"
}));
assert.deepEqual(parsePublicCommunityFeedbackStatus("LmNoPqRsTuVwXyZaBcDe", {
  schemaVersion: 1,
  feedbackId: "LmNoPqRsTuVwXyZaBcDe",
  category: "mobile",
  status: "planned",
  createdAt: { toMillis: () => 1_000 },
  updatedAt: { seconds: 2 }
}), {
  feedbackId: "LmNoPqRsTuVwXyZaBcDe",
  category: "mobile",
  status: "planned",
  createdAt: 1_000,
  updatedAt: 2_000
});
assert.equal(parsePublicCommunityFeedbackStatus("LmNoPqRsTuVwXyZaBcDe", {
  schemaVersion: 1,
  feedbackId: "DifferentReceipt1234",
  category: "mobile",
  status: "planned",
  createdAt: { seconds: 1 },
  updatedAt: { seconds: 2 }
}), null);
assert.deepEqual(normalizeCommunityFeedbackReceiptIds([
  "LmNoPqRsTuVwXyZaBcDe",
  "invalid",
  "LmNoPqRsTuVwXyZaBcDe",
  "AbCdEfGhIjKlMnOpQrSt"
]), ["LmNoPqRsTuVwXyZaBcDe", "AbCdEfGhIjKlMnOpQrSt"]);
const receiptMemory = new Map<string, string>();
const receiptStorage = {
  getItem: (key: string) => receiptMemory.get(key) ?? null,
  setItem: (key: string, value: string) => { receiptMemory.set(key, value); }
};
assert.deepEqual(rememberCommunityFeedbackReceipt("LmNoPqRsTuVwXyZaBcDe", receiptStorage), ["LmNoPqRsTuVwXyZaBcDe"]);
assert.deepEqual(rememberCommunityFeedbackReceipt("AbCdEfGhIjKlMnOpQrSt", receiptStorage), ["AbCdEfGhIjKlMnOpQrSt", "LmNoPqRsTuVwXyZaBcDe"]);
assert.deepEqual(readCommunityFeedbackReceiptIds(receiptStorage), ["AbCdEfGhIjKlMnOpQrSt", "LmNoPqRsTuVwXyZaBcDe"]);
assert.deepEqual(forgetCommunityFeedbackReceipt("AbCdEfGhIjKlMnOpQrSt", receiptStorage), ["LmNoPqRsTuVwXyZaBcDe"]);
assert.equal(parseCommunityPresence({
  online: 1_001,
  approximate: true,
  capped: true,
  observedAt: "2026-07-29T12:00:00.000Z"
}), null);

const routeSource = readFileSync(new URL("../app/api/community/messages/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /verifyIdToken\(token, true\)/);
assert.match(routeSource, /communityIdentitySecret/);
assert.match(routeSource, /communityAuthorKey/);
assert.match(routeSource, /communityActors/);
assert.match(routeSource, /runTransaction/);
assert.doesNotMatch(routeSource, /authorLabel:\s*input|authorKind:\s*input|firebaseUid:\s*.*messageReference/);

const identitySource = readFileSync(new URL("./server/community-identity.ts", import.meta.url), "utf8");
assert.match(identitySource, /COMMUNITY_IDENTITY_SECRET/);
assert.match(identitySource, /createHmac/);

const presenceRouteSource = readFileSync(new URL("../app/api/community/presence/route.ts", import.meta.url), "utf8");
assert.match(presenceRouteSource, /verifyIdToken\(token, true\)/);
assert.match(presenceRouteSource, /communityAuthorKey/);
assert.match(presenceRouteSource, /communityPresence/);
assert.match(presenceRouteSource, /\.where\("expiresAt", ">",/);
assert.match(presenceRouteSource, /\.count\(\)\.get\(\)/);
assert.doesNotMatch(presenceRouteSource, /firebaseUid|uid:\s*identity\.uid/);

const reportRouteSource = readFileSync(new URL("../app/api/community/reports/route.ts", import.meta.url), "utf8");
assert.match(reportRouteSource, /verifyIdToken\(token, true\)/);
assert.match(reportRouteSource, /communityAuthorKey/);
assert.match(reportRouteSource, /message\.authorKey === reporterKey/);
assert.match(reportRouteSource, /communityReports/);
assert.doesNotMatch(reportRouteSource, /firebaseUid|reporterUid|email:/);

const moderationRouteSource = readFileSync(new URL("../app/api/admin/community/moderation/route.ts", import.meta.url), "utf8");
assert.match(moderationRouteSource, /RMT_ADMIN_EMAIL/);
assert.match(moderationRouteSource, /email_verified !== true/);
assert.match(moderationRouteSource, /communityModerationAudit/);
assert.match(moderationRouteSource, /bannedUntil/);
assert.match(moderationRouteSource, /status: "moderated"/);

const feedbackRouteSource = readFileSync(new URL("../app/api/community/feedback/route.ts", import.meta.url), "utf8");
assert.match(feedbackRouteSource, /verifyIdToken\(token, true\)/);
assert.match(feedbackRouteSource, /communityAuthorKey/);
assert.match(feedbackRouteSource, /communityFeedbackStatus/);
assert.match(feedbackRouteSource, /feedbackWindowCount/);
assert.match(feedbackRouteSource, /validateCommunityFeedbackContent/);
assert.match(feedbackRouteSource, /export async function DELETE/);
assert.match(feedbackRouteSource, /record\?\.authorKey !== authorKey/);
assert.match(feedbackRouteSource, /transaction\.delete\(feedbackReference\)/);
assert.match(feedbackRouteSource, /action: "author_withdrawn"/);
assert.doesNotMatch(feedbackRouteSource, /firebaseUid|authorUid|email:/);
const publicStatusWrite = feedbackRouteSource.match(/transaction\.create\(statusReference,\s*\{([\s\S]*?)\}\);/)?.[1] ?? "";
assert.ok(publicStatusWrite);
assert.doesNotMatch(publicStatusWrite, /authorKey|identityKind|title|description|reviewNote/);
const withdrawalAuditWrite = feedbackRouteSource.match(/transaction\.create\(auditReference,\s*\{([\s\S]*?)\}\);/)?.[1] ?? "";
assert.ok(withdrawalAuditWrite);
assert.doesNotMatch(withdrawalAuditWrite, /authorKey|identityKind|title|description|reviewNote|reviewerKey/);

const feedbackAdminSource = readFileSync(new URL("../app/api/admin/community/feedback/route.ts", import.meta.url), "utf8");
assert.match(feedbackAdminSource, /RMT_ADMIN_EMAIL/);
assert.match(feedbackAdminSource, /TRANSITIONS/);
assert.match(feedbackAdminSource, /communityFeedbackAudit/);
assert.match(feedbackAdminSource, /communityFeedbackStatus/);

const communityCloudSource = readFileSync(new URL("./community-cloud.ts", import.meta.url), "utf8");
assert.match(communityCloudSource, /communityFeedbackStatus/);
assert.match(communityCloudSource, /parsePublicCommunityFeedbackStatus/);
assert.match(communityCloudSource, /withdrawCommunityFeedback/);
assert.match(communityCloudSource, /method: "DELETE"/);
assert.doesNotMatch(communityCloudSource, /communityFeedback", feedbackId/);

const profileProviderSource = readFileSync(new URL("../app/profile-provider.tsx", import.meta.url), "utf8");
assert.match(profileProviderSource, /nextUser\?\.isAnonymous \? null : nextUser/);

console.info("RMT Live community foundation smoke test passed");
