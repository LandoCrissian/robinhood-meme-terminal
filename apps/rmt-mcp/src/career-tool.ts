import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaPublicCareerProfile,
  type PaperArenaPublicCareerProfile,
} from "../../agent-engine/src/paper-arena-public-career-profile.ts";

export const RMT_MCP_CAREER_TOOL_V1 = "RMT_MCP_CAREER_TOOL_V1" as const;

export interface RmtArenaPublicCareerProfileReader {
  read(input: { participantType: "AGENT" | "HUMAN"; participantId: string }): Promise<PaperArenaPublicCareerProfile>;
}

export interface RmtArenaCareerToolDescriptor {
  name: "rmt_arena_career";
  title: "RMT Arena Career";
  description: string;
  readOnly: true;
  destructive: false;
  inputSchema: Record<string, unknown>;
}

export interface RmtArenaCareerToolResult {
  schemaVersion: 1;
  tool: "rmt_arena_career";
  contractVersion: typeof RMT_MCP_CAREER_TOOL_V1;
  profile: PaperArenaPublicCareerProfile;
  resultHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("rmt_arena_career input must be an object");
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

export function rmtArenaCareerToolDescriptor(): RmtArenaCareerToolDescriptor {
  return {
    name: "rmt_arena_career",
    title: "RMT Arena Career",
    description: "Read sanitized cross-season finalized Arena reputation for a registered Agent or Human.",
    readOnly: true,
    destructive: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["participantType", "participantId"],
      properties: {
        participantType: { type: "string", enum: ["AGENT", "HUMAN"] },
        participantId: { type: "string", minLength: 1 },
      },
    },
  };
}

export function assertRmtArenaCareerToolResult(record: RmtArenaCareerToolResult): void {
  if (record.schemaVersion !== 1 || record.tool !== "rmt_arena_career" || record.contractVersion !== RMT_MCP_CAREER_TOOL_V1) {
    fail("unsupported RMT MCP career tool-result version");
  }
  assertPaperArenaPublicCareerProfile(record.profile);
  assertHash(record.resultHash, "RMT MCP career resultHash");
  const { resultHash, ...payload } = record;
  if (resultHash !== hashCanonicalPayload(payload)) fail("RMT MCP career result hash mismatch");
}

export class RmtMcpCareerReadToolService {
  private readonly reader: RmtArenaPublicCareerProfileReader;

  constructor(reader: RmtArenaPublicCareerProfileReader) {
    this.reader = reader;
  }

  descriptor(): RmtArenaCareerToolDescriptor {
    return structuredClone(rmtArenaCareerToolDescriptor());
  }

  async call(input: unknown): Promise<RmtArenaCareerToolResult> {
    assertRecord(input);
    if (Object.keys(input).some((key) => key !== "participantType" && key !== "participantId")) {
      fail("rmt_arena_career input contains unsupported fields");
    }
    if (input.participantType !== "AGENT" && input.participantType !== "HUMAN") fail("rmt_arena_career participantType is invalid");
    assertNonEmpty(input.participantId, "rmt_arena_career participantId");
    const profile = await this.reader.read({
      participantType: input.participantType,
      participantId: input.participantId.trim(),
    });
    assertPaperArenaPublicCareerProfile(profile);
    const payload: Omit<RmtArenaCareerToolResult, "resultHash"> = {
      schemaVersion: 1,
      tool: "rmt_arena_career",
      contractVersion: RMT_MCP_CAREER_TOOL_V1,
      profile: structuredClone(profile),
    };
    const result: RmtArenaCareerToolResult = { ...payload, resultHash: hashCanonicalPayload(payload) };
    assertRmtArenaCareerToolResult(result);
    return result;
  }
}
