import { assertNonEmptyString, hashCanonicalPayload } from "../../../../packages/agent-core/src/index.ts";
import type { AgentEngineSnapshot } from "../snapshot.ts";

export interface StoredAgentEngineState {
  revision: number;
  snapshot: AgentEngineSnapshot;
}

export interface StoredMutationReplay {
  operation: string;
  requestHash: string;
  result: unknown;
  revision: number;
  snapshot: AgentEngineSnapshot;
}

export type AgentStateCommitResult =
  | {
      status: "COMMITTED";
      revision: number;
      snapshot: AgentEngineSnapshot;
      result: unknown;
    }
  | {
      status: "REPLAYED";
      revision: number;
      snapshot: AgentEngineSnapshot;
      result: unknown;
    }
  | {
      status: "CONFLICT";
      revision: number;
      snapshot: AgentEngineSnapshot;
    };

export interface AgentStateCommitInput {
  streamId: string;
  expectedRevision: number;
  idempotencyKey: string;
  operation: string;
  requestHash: string;
  result: unknown;
  snapshot: AgentEngineSnapshot;
  createdAt: number;
}

export interface AgentStateStore {
  load(streamId: string): Promise<StoredAgentEngineState | null>;
  lookupMutation(streamId: string, idempotencyKey: string, requestHash: string): Promise<StoredMutationReplay | null>;
  commit(input: AgentStateCommitInput): Promise<AgentStateCommitResult>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertRevision(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
}

function mutationMapKey(streamId: string, idempotencyKey: string): string {
  return `${streamId}\u0000${idempotencyKey}`;
}

interface InMemoryMutationRecord {
  operation: string;
  requestHash: string;
  result: unknown;
  revision: number;
}

export class InMemoryAgentStateStore implements AgentStateStore {
  private readonly states = new Map<string, StoredAgentEngineState>();
  private readonly mutations = new Map<string, InMemoryMutationRecord>();

  async load(streamId: string): Promise<StoredAgentEngineState | null> {
    assertNonEmptyString(streamId, "streamId");
    const state = this.states.get(streamId);
    return state ? clone(state) : null;
  }

  async lookupMutation(streamId: string, idempotencyKey: string, requestHash: string): Promise<StoredMutationReplay | null> {
    assertNonEmptyString(streamId, "streamId");
    assertNonEmptyString(idempotencyKey, "idempotencyKey");
    assertNonEmptyString(requestHash, "requestHash");
    const mutation = this.mutations.get(mutationMapKey(streamId, idempotencyKey));
    if (!mutation) return null;
    if (mutation.requestHash !== requestHash) throw new Error("idempotency key was already used for a different request");
    const state = this.states.get(streamId);
    if (!state) throw new Error("idempotency record exists without canonical engine state");
    return {
      operation: mutation.operation,
      requestHash: mutation.requestHash,
      result: clone(mutation.result),
      revision: state.revision,
      snapshot: clone(state.snapshot),
    };
  }

  async commit(input: AgentStateCommitInput): Promise<AgentStateCommitResult> {
    assertNonEmptyString(input.streamId, "streamId");
    assertNonEmptyString(input.idempotencyKey, "idempotencyKey");
    assertNonEmptyString(input.operation, "operation");
    assertNonEmptyString(input.requestHash, "requestHash");
    assertRevision(input.expectedRevision, "expectedRevision");
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) throw new Error("createdAt must be a non-negative safe integer");
    const key = mutationMapKey(input.streamId, input.idempotencyKey);
    const existingMutation = this.mutations.get(key);
    const current = this.states.get(input.streamId) ?? null;

    if (existingMutation) {
      if (existingMutation.requestHash !== input.requestHash || existingMutation.operation !== input.operation) {
        throw new Error("idempotency key was already used for a different request");
      }
      if (!current) throw new Error("idempotency record exists without canonical engine state");
      return {
        status: "REPLAYED",
        revision: current.revision,
        snapshot: clone(current.snapshot),
        result: clone(existingMutation.result),
      };
    }

    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      if (!current) throw new Error("revision conflict without canonical engine state");
      return { status: "CONFLICT", revision: current.revision, snapshot: clone(current.snapshot) };
    }

    const revision = currentRevision + 1;
    assertRevision(revision, "next revision");
    const snapshot = clone(input.snapshot);
    this.states.set(input.streamId, { revision, snapshot });
    this.mutations.set(key, {
      operation: input.operation,
      requestHash: input.requestHash,
      result: clone(input.result),
      revision,
    });
    return { status: "COMMITTED", revision, snapshot: clone(snapshot), result: clone(input.result) };
  }
}

export function hashDurableRequest(operation: string, payload: unknown): string {
  assertNonEmptyString(operation, "operation");
  return hashCanonicalPayload({ operation, payload });
}
