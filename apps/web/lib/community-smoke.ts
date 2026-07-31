import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMUNITY_ACTOR_RETENTION_MS,
  COMMUNITY_AUDIT_RETENTION_MS,
  COMMUNITY_MESSAGE_RETENTION_MS,
  COMMUNITY_PRESENCE_HEARTBEAT_MS,
  COMMUNITY_PRESENCE_TTL_MS,
  COMMUNITY_PRIVATE_RETENTION_MS,
  COMMUNITY_PUBLIC_STATUS_RETENTION_MS,
  normalizeCommunityBody,
  normalizeCommunityRoomId,
  parseCommunityMessage,
  parseCommunityPresence,
  validateCommunityBody
} from "./community";
import {
  normalizeCommunityReportReason,
  parseAdminCommunityMessage,
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
import {
  COMMUNITY_TERMS_VERSION,
  communityTermsAcceptanceRecord,
  parseCommunityTermsAcceptance
} from "./community-terms";
import {
  COMMUNITY_GUEST_MESSAGE_LIMIT,
  COMMUNITY_MEMBER_MESSAGE_LIMIT,
  COMMUNITY_MESSAGE_COOLDOWN_MS,
  COMMUNITY_MESSAGE_WINDOW_MS,
  decideCommunityMessagePolicy
} from "./server/community-message-policy";
import { decideCommunityRateLimit } from "./server/community-rate-limit";

assert.equal(normalizeCommunityRoomId("global"), "global");
assert.equal(normalizeCommunityRoomId("project--rmt-studio"), "project--rmt-studio");
assert.equal(normalizeCommunityRoomId("project--../../admin"), "");
assert.equal(normalizeCommunityBody("  Hello\n\nRMT  "), "Hello RMT");
assert.match(validateCommunityBody("https://malicious.example", true) ?? "", /cannot include external links/);
assert.match(validateCommunityBody("my private key is abc", false) ?? "", /Never share/);
assert.equal(validateCommunityBody("Watching the RMT curve markets today.", true), null);
assert.ok(COMMUNITY_MESSAGE_RETENTION_MS < COMMUNITY_PRIVATE_RETENTION_MS);
assert.ok(COMMUNITY_PRIVATE_RETENTION_MS < COMMUNITY_PUBLIC_STATUS_RETENTION_MS);
assert.equal(COMMUNITY_PUBLIC_STATUS_RETENTION_MS, COMMUNITY_AUDIT_RETENTION_MS);
assert.equal(COMMUNITY_ACTOR_RETENTION_MS, COMMUNITY_AUDIT_RETENTION_MS);
assert.equal(parseCommunityTermsAcceptance(null), false);
assert.equal(parseCommunityTermsAcceptance(JSON.stringify({
  version: "old",
  acceptedAt: "2026-07-29T00:00:00.000Z"
})), false);
assert.equal(parseCommunityTermsAcceptance(JSON.stringify({
  version: COMMUNITY_TERMS_VERSION,
  acceptedAt: "invalid"
})), false);
assert.equal(parseCommunityTermsAcceptance(
  communityTermsAcceptanceRecord(new Date("2026-07-29T00:00:00.000Z"))
), true);

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
assert.ok(parseAdminCommunityMessage({
  messageId: "AbCdEfGhIjKlMnOpQrSt",
  roomId: "global",
  authorKind: "rmt",
  authorLabel: "RMT-Dev",
  authorHandle: "RMTLaunch",
  messageBody: "Testing the RMT Live moderation controls.",
  createdAt: "2026-07-29T12:00:00.000Z"
}));
assert.equal(parseAdminCommunityMessage({
  messageId: "AbCdEfGhIjKlMnOpQrSt",
  roomId: "global",
  authorKind: "rmt",
  authorLabel: "RMT-Dev",
  authorHandle: "RMTLaunch",
  messageBody: "Testing the RMT Live moderation controls.",
  createdAt: "invalid"
}), null);
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
assert.deepEqual(decideCommunityRateLimit(undefined, {
  limit: 2,
  windowMs: 60_000,
  now: 1_000
}), {
  allowed: true,
  count: 1,
  resetAt: 61_000,
  retryAfterSeconds: 0
});
assert.deepEqual(decideCommunityRateLimit({
  count: 1,
  resetAt: { toMillis: () => 61_000 }
}, {
  limit: 2,
  windowMs: 60_000,
  now: 2_000
}), {
  allowed: true,
  count: 2,
  resetAt: 61_000,
  retryAfterSeconds: 0
});
assert.deepEqual(decideCommunityRateLimit({
  count: 2,
  resetAt: { toMillis: () => 61_000 }
}, {
  limit: 2,
  windowMs: 60_000,
  now: 31_000
}), {
  allowed: false,
  count: 2,
  resetAt: 61_000,
  retryAfterSeconds: 30
});
assert.equal(decideCommunityRateLimit({
  count: 999,
  resetAt: { toMillis: () => 1_000 }
}, {
  limit: 2,
  windowMs: 60_000,
  now: 2_000
}).count, 1);
const timestamp = (milliseconds: number) => ({ toMillis: () => milliseconds });
assert.deepEqual(decideCommunityMessagePolicy(undefined, {
  guest: true,
  now: 10_000
}), {
  allowed: true,
  sameWindow: false,
  windowCount: 0,
  nextWindowCount: 1
});
assert.deepEqual(decideCommunityMessagePolicy({
  bannedUntil: timestamp(10_001)
}, {
  guest: true,
  now: 10_000
}), { allowed: false, reason: "banned" });
assert.deepEqual(decideCommunityMessagePolicy({
  bannedUntil: timestamp(10_000),
  lastMessageAt: timestamp(10_000 - COMMUNITY_MESSAGE_COOLDOWN_MS)
}, {
  guest: true,
  now: 10_000
}), {
  allowed: true,
  sameWindow: false,
  windowCount: 0,
  nextWindowCount: 1
});
assert.deepEqual(decideCommunityMessagePolicy({
  lastMessageAt: timestamp(10_000 - COMMUNITY_MESSAGE_COOLDOWN_MS + 1)
}, {
  guest: true,
  now: 10_000
}), { allowed: false, reason: "cooldown" });
assert.deepEqual(decideCommunityMessagePolicy({
  lastMessageAt: timestamp(10_001)
}, {
  guest: true,
  now: 10_000
}), { allowed: false, reason: "cooldown" });
assert.deepEqual(decideCommunityMessagePolicy({
  windowStartedAt: timestamp(10_000 - COMMUNITY_MESSAGE_WINDOW_MS + 1),
  windowCount: COMMUNITY_GUEST_MESSAGE_LIMIT
}, {
  guest: true,
  now: 10_000
}), { allowed: false, reason: "quota" });
assert.deepEqual(decideCommunityMessagePolicy({
  windowStartedAt: timestamp(10_000 - COMMUNITY_MESSAGE_WINDOW_MS + 1),
  windowCount: COMMUNITY_GUEST_MESSAGE_LIMIT
}, {
  guest: false,
  now: 10_000
}), {
  allowed: true,
  sameWindow: true,
  windowCount: COMMUNITY_GUEST_MESSAGE_LIMIT,
  nextWindowCount: COMMUNITY_GUEST_MESSAGE_LIMIT + 1
});
assert.deepEqual(decideCommunityMessagePolicy({
  windowStartedAt: timestamp(10_000 - COMMUNITY_MESSAGE_WINDOW_MS + 1),
  windowCount: COMMUNITY_MEMBER_MESSAGE_LIMIT
}, {
  guest: false,
  now: 10_000
}), { allowed: false, reason: "quota" });
assert.deepEqual(decideCommunityMessagePolicy({
  windowStartedAt: timestamp(10_000 - COMMUNITY_MESSAGE_WINDOW_MS),
  windowCount: COMMUNITY_MEMBER_MESSAGE_LIMIT
}, {
  guest: false,
  now: 10_000
}), {
  allowed: true,
  sameWindow: false,
  windowCount: 0,
  nextWindowCount: 1
});
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
assert.match(routeSource, /COMMUNITY_MESSAGE_RETENTION_MS/);
assert.match(routeSource, /COMMUNITY_ACTOR_RETENTION_MS/);
assert.match(routeSource, /expiresAt/);
assert.match(routeSource, /COMMUNITY_TERMS_VERSION/);
assert.match(routeSource, /status: 428/);
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
assert.match(reportRouteSource, /COMMUNITY_PRIVATE_RETENTION_MS/);
assert.match(reportRouteSource, /expiresAt/);
assert.doesNotMatch(reportRouteSource, /firebaseUid|reporterUid|email:/);

const moderationRouteSource = readFileSync(new URL("../app/api/admin/community/moderation/route.ts", import.meta.url), "utf8");
assert.match(moderationRouteSource, /RMT_ADMIN_EMAIL/);
assert.match(moderationRouteSource, /email_verified !== true/);
assert.match(moderationRouteSource, /communityModerationAudit/);
assert.match(moderationRouteSource, /bannedUntil/);
assert.match(moderationRouteSource, /status: "moderated"/);
assert.match(moderationRouteSource, /COMMUNITY_AUDIT_RETENTION_MS/);
assert.match(moderationRouteSource, /COMMUNITY_ACTOR_RETENTION_MS/);
assert.match(moderationRouteSource, /input\.operation === "list_messages"/);
assert.match(moderationRouteSource, /input\.operation === "hide_message"/);
assert.match(moderationRouteSource, /source: "admin_direct"/);
assert.match(moderationRouteSource, /Direct admin action:/);
const recentVisibleMessagesSource = moderationRouteSource.match(/async function recentVisibleMessages[\s\S]*?\n}/)?.[0] ?? "";
assert.ok(recentVisibleMessagesSource);
assert.doesNotMatch(recentVisibleMessagesSource, /authorKey|firebaseUid|email/);

const communityMessageManagerSource = readFileSync(new URL("../app/admin/creator-applications/community-message-manager.tsx", import.meta.url), "utf8");
assert.match(communityMessageManagerSource, /Choose a removal reason/);
assert.match(communityMessageManagerSource, /Hide from RMT Live/);
assert.match(communityMessageManagerSource, /private moderation record/);

const adminPageSource = readFileSync(new URL("../app/admin/creator-applications/page.tsx", import.meta.url), "utf8");
assert.match(adminPageSource, /<h1>RMT Admin<\/h1>/);
assert.match(adminPageSource, /<CommunityMessageManager admin=\{user\}/);

const profilePageSource = readFileSync(new URL("../app/profile/page.tsx", import.meta.url), "utf8");
assert.match(profilePageSource, /Open Admin Dashboard/);
assert.match(profilePageSource, /href="\/admin"/);

const publicChromeSource = readFileSync(new URL("../app/public-chrome.tsx", import.meta.url), "utf8");
assert.match(publicChromeSource, /Private operations/);
assert.match(publicChromeSource, /RMT Admin/);
assert.match(publicChromeSource, /href="\/admin"/);

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
assert.match(feedbackRouteSource, /COMMUNITY_PRIVATE_RETENTION_MS/);
assert.match(feedbackRouteSource, /COMMUNITY_PUBLIC_STATUS_RETENTION_MS/);
assert.match(feedbackRouteSource, /COMMUNITY_AUDIT_RETENTION_MS/);
assert.match(feedbackRouteSource, /COMMUNITY_TERMS_VERSION/);
assert.match(feedbackRouteSource, /status: 428/);
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
assert.match(feedbackAdminSource, /COMMUNITY_AUDIT_RETENTION_MS/);

const communityCloudSource = readFileSync(new URL("./community-cloud.ts", import.meta.url), "utf8");
assert.match(communityCloudSource, /communityFeedbackStatus/);
assert.match(communityCloudSource, /parsePublicCommunityFeedbackStatus/);
assert.match(communityCloudSource, /withdrawCommunityFeedback/);
assert.match(communityCloudSource, /method: "DELETE"/);
assert.match(communityCloudSource, /communityTermsVersion: COMMUNITY_TERMS_VERSION/);
assert.doesNotMatch(communityCloudSource, /communityFeedback", feedbackId/);

const distributedRateSource = readFileSync(new URL("./server/community-rate-limit.ts", import.meta.url), "utf8");
assert.match(distributedRateSource, /createHmac\("sha256"/);
assert.match(distributedRateSource, /communityRateLimits/);
assert.match(distributedRateSource, /runTransaction/);
assert.match(distributedRateSource, /expiresAt/);
const distributedBucketWrite = distributedRateSource.match(/transaction\.set\(reference,\s*\{([\s\S]*?)\}\);/)?.[1] ?? "";
assert.ok(distributedBucketWrite);
assert.doesNotMatch(distributedBucketWrite, /address|ip|authorKey|firebaseUid|email/);

const retentionSource = readFileSync(new URL("./server/community-retention.ts", import.meta.url), "utf8");
assert.match(retentionSource, /communityMaintenance/);
assert.match(retentionSource, /collectionGroup\("messages"\)/);
assert.match(retentionSource, /DELETE_LIMIT_PER_COLLECTION = 20/);
assert.match(retentionSource, /RETENTION_SWEEP_INTERVAL_MS = 6 \* 60 \* 60_000/);
assert.match(presenceRouteSource, /runCommunityRetentionSweep/);

for (const route of ["messages", "reports", "presence", "feedback"]) {
  const source = readFileSync(new URL(`../app/api/community/${route}/route.ts`, import.meta.url), "utf8");
  assert.match(source, /consumeCommunityRateLimit/);
  assert.match(source, /Retry-After/);
}

const communityLiveSource = readFileSync(new URL("../app/community-live.tsx", import.meta.url), "utf8");
const communityStyles = readFileSync(new URL("../app/community.css", import.meta.url), "utf8");
assert.match(communityLiveSource, /COMMUNITY_TERMS_STORAGE_KEY/);
assert.match(communityLiveSource, /I agree — enter RMT Live/);
assert.match(communityLiveSource, /RMT Live is ready/);
assert.match(communityLiveSource, /identityReady \? "Access ready" : "Start guest access"/);
assert.doesNotMatch(communityLiveSource, /will open after secure Firebase activation/);
assert.match(communityLiveSource, /view !== "updates"/);
assert.match(communityLiveSource, /aria-controls="rmt-live-panel"/);
assert.match(communityLiveSource, /aria-labelledby="rmt-live-heading"/);
assert.match(communityLiveSource, /communityLiveLetters/);
assert.match(communityLiveSource, /communityLiveBackdrop/);
assert.match(communityLiveSource, /role="dialog" aria-modal="true"/);
assert.match(communityLiveSource, /aria-label="Message RMT Live"/);
assert.match(communityLiveSource, /role="group" aria-label="Report reason"/);
assert.match(communityLiveSource, /event\.key !== "Escape"/);
assert.match(communityStyles, /\.communityLive\.open\{inset:0;transform:none\}/);
assert.match(communityStyles, /communityLiveSlideIn/);
assert.match(communityStyles, /body:has\(\.universalTradeRail\.mobileOpen\)/);

const termsSource = readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
assert.match(termsSource, /RMT Live community/);
assert.match(termsSource, /market manipulation/);
assert.match(termsSource, /recovery words/);

const profileProviderSource = readFileSync(new URL("../app/profile-provider.tsx", import.meta.url), "utf8");
assert.match(profileProviderSource, /nextUser\?\.isAnonymous \? null : nextUser/);

console.info("RMT Live community foundation smoke test passed");
