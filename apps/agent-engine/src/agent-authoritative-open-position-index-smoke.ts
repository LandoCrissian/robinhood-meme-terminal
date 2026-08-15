import assert from "node:assert/strict";
import * as publicApi from "./index.ts";

assert.equal(typeof publicApi.PaperCanonicalRiskSnapshotService, "function");
assert.equal(typeof publicApi.AgentCanonicalRiskSnapshotService, "function");
assert.equal(typeof publicApi.AgentCanonicalOpenPositionAdmissionService, "function");
assert.equal(typeof publicApi.AgentAuthoritativeOpenPositionAdmissionService, "function");
assert.equal(typeof publicApi.InMemoryPaperCanonicalValuationHistoryStore, "function");

console.log("agent-authoritative-open-position index smoke: ok");
