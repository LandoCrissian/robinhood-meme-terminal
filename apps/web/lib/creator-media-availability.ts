import { keccak256, toHex, type Hex } from "viem";

export const CREATOR_MEDIA_AVAILABILITY_SCHEMA_VERSION = 1 as const;

export type CreatorMediaAvailabilityState = "healthy" | "degraded" | "unavailable";
export type CreatorMediaProviderState = "verified" | "missing" | "unknown";
export type CreatorMediaGatewayState = "available" | "partial" | "unavailable";

export type CreatorMediaAvailabilityObservation = {
  schemaVersion: typeof CREATOR_MEDIA_AVAILABILITY_SCHEMA_VERSION;
  observationId: string;
  observationHash: Hex;
  receiptId: string;
  projectSlug: string;
  assetId: string;
  metadataCid: string;
  providerState: CreatorMediaProviderState;
  gatewayState: CreatorMediaGatewayState;
  overallState: CreatorMediaAvailabilityState;
  checksAttempted: number;
  checksPassed: number;
  failureCode: string;
  observedAtMs: number;
  providerExecution: "disabled";
};

export type CreatorMediaAvailabilityStatus = CreatorMediaAvailabilityObservation & {
  consecutiveFailures: number;
  lastHealthyAtMs: number;
  updatedAt?: unknown;
};

type ObservationPayload = Omit<
  CreatorMediaAvailabilityObservation,
  "observationId" | "observationHash"
>;

export function createCreatorMediaAvailabilityObservation(input: ObservationPayload) {
  if (
    !/^[0-9a-f]{64}$/.test(input.receiptId)
    || !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(input.projectSlug)
    || !/^[A-Za-z0-9]{20}$/.test(input.assetId)
    || !/^Qm[1-9A-HJ-NP-Za-km-z]{44}$|^b[a-z2-7]{20,}$/.test(input.metadataCid)
    || !["verified", "missing", "unknown"].includes(input.providerState)
    || !["available", "partial", "unavailable"].includes(input.gatewayState)
    || !["healthy", "degraded", "unavailable"].includes(input.overallState)
    || !Number.isSafeInteger(input.checksAttempted)
    || input.checksAttempted < 1
    || input.checksAttempted > 4
    || !Number.isSafeInteger(input.checksPassed)
    || input.checksPassed < 0
    || input.checksPassed > input.checksAttempted
    || typeof input.failureCode !== "string"
    || input.failureCode.length > 80
    || !Number.isSafeInteger(input.observedAtMs)
    || input.observedAtMs < 1_700_000_000_000
    || input.providerExecution !== "disabled"
  ) throw new Error("The media-availability observation is invalid.");
  const observationHash = keccak256(toHex(JSON.stringify(input)));
  return {
    ...input,
    observationId: observationHash.slice(2),
    observationHash
  } satisfies CreatorMediaAvailabilityObservation;
}

export function parseCreatorMediaAvailabilityObservation(
  observationId: string,
  value: unknown
): CreatorMediaAvailabilityObservation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CreatorMediaAvailabilityObservation;
  try {
    const payload: ObservationPayload = {
      schemaVersion: candidate.schemaVersion,
      receiptId: candidate.receiptId,
      projectSlug: candidate.projectSlug,
      assetId: candidate.assetId,
      metadataCid: candidate.metadataCid,
      providerState: candidate.providerState,
      gatewayState: candidate.gatewayState,
      overallState: candidate.overallState,
      checksAttempted: candidate.checksAttempted,
      checksPassed: candidate.checksPassed,
      failureCode: candidate.failureCode,
      observedAtMs: candidate.observedAtMs,
      providerExecution: candidate.providerExecution
    };
    const parsed = createCreatorMediaAvailabilityObservation(payload);
    return (
      candidate.schemaVersion === CREATOR_MEDIA_AVAILABILITY_SCHEMA_VERSION
      && observationId === parsed.observationId
      && candidate.observationId === parsed.observationId
      && candidate.observationHash === parsed.observationHash
    ) ? parsed : null;
  } catch {
    return null;
  }
}

export function availabilityStatusFromObservation(
  observation: CreatorMediaAvailabilityObservation,
  previous: CreatorMediaAvailabilityStatus | null
): CreatorMediaAvailabilityStatus {
  const healthy = observation.overallState === "healthy";
  return {
    ...observation,
    consecutiveFailures: healthy ? 0 : Math.min(365, (previous?.consecutiveFailures ?? 0) + 1),
    lastHealthyAtMs: healthy
      ? observation.observedAtMs
      : previous?.lastHealthyAtMs ?? 0
  };
}

export function parseCreatorMediaAvailabilityStatus(
  receiptId: string,
  value: unknown
): CreatorMediaAvailabilityStatus | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CreatorMediaAvailabilityStatus;
  const observation = parseCreatorMediaAvailabilityObservation(candidate.observationId, candidate);
  if (
    !observation
    || observation.receiptId !== receiptId
    || !Number.isSafeInteger(candidate.consecutiveFailures)
    || candidate.consecutiveFailures < 0
    || candidate.consecutiveFailures > 365
    || !Number.isSafeInteger(candidate.lastHealthyAtMs)
    || candidate.lastHealthyAtMs < 0
    || candidate.lastHealthyAtMs > candidate.observedAtMs
  ) return null;
  return {
    ...observation,
    consecutiveFailures: candidate.consecutiveFailures,
    lastHealthyAtMs: candidate.lastHealthyAtMs,
    ...(candidate.updatedAt === undefined ? {} : { updatedAt: candidate.updatedAt })
  };
}
