import { createHash } from "node:crypto";
import { EXTERNAL_ORIGIN_CHAIN_ID } from "./config.js";

export type ExternalOriginEvidence = Readonly<{
  chainId: typeof EXTERNAL_ORIGIN_CHAIN_ID;
  adapterId: string;
  manifestHash: `0x${string}`;
  claimKind: "token-created" | "source-listed";
  token: `0x${string}`;
  factory: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
  transactionIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  creator: `0x${string}` | null;
  market: `0x${string}` | null;
}>;

export function canonicalExternalOriginEvidence(
  evidence: ExternalOriginEvidence
) {
  return JSON.stringify({
    schema: "rmt-external-origin-evidence-v1",
    chainId: evidence.chainId,
    adapterId: evidence.adapterId,
    manifestHash: evidence.manifestHash,
    claimKind: evidence.claimKind,
    token: evidence.token,
    factory: evidence.factory,
    transactionHash: evidence.transactionHash,
    logIndex: evidence.logIndex,
    transactionIndex: evidence.transactionIndex,
    blockNumber: evidence.blockNumber.toString(),
    blockHash: evidence.blockHash,
    creator: evidence.creator,
    market: evidence.market
  });
}

export function deriveExternalOriginEvidenceHash(
  evidence: ExternalOriginEvidence
): `0x${string}` {
  const digest = createHash("sha256")
    .update(canonicalExternalOriginEvidence(evidence), "utf8")
    .digest("hex");
  return `0x${digest}`;
}
