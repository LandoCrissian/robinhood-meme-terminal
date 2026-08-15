import assert from "node:assert/strict";
import * as agentCore from "@rmt/agent-core";
import * as agentPublic from "@rmt/agent-engine/public";
import * as rmtMcp from "@rmt/rmt-mcp";

assert.equal(typeof agentCore.hashCanonicalPayload, "function", "Agent Core root export must resolve");
assert.deepEqual(
  Object.keys(agentPublic).sort(),
  [
    "RMT_ARENA_PUBLIC_CAREER_PROFILE_V1",
    "RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1",
    "RMT_ARENA_PUBLIC_READ_MODEL_V1",
    "RMT_ARENA_PUBLIC_SEASON_CATALOG_V1",
    "RMT_ARENA_PUBLIC_SEASON_RESULT_V1",
    "assertPaperArenaPublicCareerProfile",
    "assertPaperArenaPublicParticipantProfile",
    "assertPaperArenaPublicReadModel",
    "assertPaperArenaPublicSeasonCatalog",
    "assertPaperArenaPublicSeasonResult",
  ].sort(),
  "Agent Engine public export must contain only sanitized model contracts",
);
assert.equal("AgentEngine" in agentPublic, false, "Agent Engine runtime must not cross the public export");
assert.equal("PostgresAgentStateStore" in agentPublic, false, "Agent Engine persistence must not cross the public export");
assert.equal(typeof rmtMcp.RmtMcpReadRegistry, "function", "RMT MCP root export must resolve");

console.log("Agent workspace package exports: ok");
