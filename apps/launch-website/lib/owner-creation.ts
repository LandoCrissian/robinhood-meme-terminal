import { createSiweMessage } from "viem/siwe";

// First production issuance. The published factory consumes each creator/intent pair once.
export const rmtCreationOwner = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
export const rmtCreationIntent = "0x9929e89d4c1e3fed5e2ca96e7620508463ac14e60f7c559f8449e2ba951672ac";
export const ownerReviewLifetimeMs = 600_000;

export function ownerReviewMessage(nonce: string, issuedAt: number) {
  if (!/^[0-9a-f]{64}$/.test(nonce) || !Number.isSafeInteger(issuedAt)) throw new Error("Invalid owner challenge");
  return createSiweMessage({ domain: "www.rmtlaunch.fun", address: rmtCreationOwner, version: "1",
    statement: "Access the unsigned RMT creation preview. This login grants no spending authority.",
    uri: "https://www.rmtlaunch.fun/create-token", chainId: 4663, requestId: rmtCreationIntent,
    nonce, issuedAt: new Date(issuedAt), expirationTime: new Date(issuedAt + ownerReviewLifetimeMs) });
}

export function isRmtCreation(fields: unknown, intentId: unknown) {
  if (!fields || typeof fields !== "object" || intentId !== rmtCreationIntent) return false;
  const draft = fields as Record<string, unknown>;
  return draft.name === "RMT" && draft.symbol === "RMT" && draft.projectURI === ""
    && draft.treasury === "" && draft.treasuryShareBps === 0;
}
