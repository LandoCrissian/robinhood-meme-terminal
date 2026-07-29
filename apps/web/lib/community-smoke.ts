import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeCommunityBody,
  normalizeCommunityRoomId,
  parseCommunityMessage,
  validateCommunityBody
} from "./community";

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

const routeSource = readFileSync(new URL("../app/api/community/messages/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /verifyIdToken\(token, true\)/);
assert.match(routeSource, /COMMUNITY_IDENTITY_SECRET/);
assert.match(routeSource, /createHmac/);
assert.match(routeSource, /communityActors/);
assert.match(routeSource, /runTransaction/);
assert.doesNotMatch(routeSource, /authorLabel:\s*input|authorKind:\s*input|firebaseUid:\s*.*messageReference/);

const profileProviderSource = readFileSync(new URL("../app/profile-provider.tsx", import.meta.url), "utf8");
assert.match(profileProviderSource, /nextUser\?\.isAnonymous \? null : nextUser/);

console.info("RMT Live community foundation smoke test passed");
