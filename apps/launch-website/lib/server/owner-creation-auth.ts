import { createHash, randomBytes } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { ownerReviewLifetimeMs, ownerReviewMessage, rmtCreationOwner } from "../owner-creation";

const cookieName = "__Host-rmt-owner-preview";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function issueOwnerReviewChallenge() {
  const secret = randomBytes(32).toString("hex");
  const issuedAt = Date.now();
  const cookie = cookieName + "=" + issuedAt + "." + secret + "; Path=/; Max-Age=" + ownerReviewLifetimeMs / 1000 + "; Secure; HttpOnly; SameSite=Strict";
  return { cookie, nonce: hash(secret), issuedAt };
}

export async function authenticatedReviewOwner(headers: Headers): Promise<string | null> {
  const signature = headers.get("authorization")?.match(/^Bearer (0x[0-9a-fA-F]{130})$/)?.[1] as Hex | undefined;
  const cookies = (headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(cookieName + "="));
  if (!signature || cookies.length !== 1) return null;
  const parts = /^(\d{13})\.([0-9a-f]{64})$/.exec(cookies[0].slice(cookieName.length + 1));
  if (!parts) return null;
  const issuedAt = Number(parts[1]), now = Date.now();
  if (issuedAt > now || issuedAt + ownerReviewLifetimeMs <= now) return null;
  try {
    return await recoverMessageAddress({ message: ownerReviewMessage(hash(parts[2]), issuedAt), signature });
  } catch { return null; }
}

export async function isAuthenticatedCreationOwner(headers: Headers) {
  return (await authenticatedReviewOwner(headers))?.toLowerCase() === rmtCreationOwner.toLowerCase();
}
