import { createHmac } from "node:crypto";

export function communityBearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/)?.[1] ?? "";
}

export function communityIdentitySecret() {
  const value = (process.env.COMMUNITY_IDENTITY_SECRET ?? "").trim();
  return value.length >= 32 ? value : "";
}

export function communityAuthorKey(secret: string, uid: string) {
  return createHmac("sha256", secret).update(uid).digest("hex").slice(0, 32);
}

export function isVerifiedRmtIdentity(identity: {
  email_verified?: unknown;
  privy_verified?: unknown;
  rmt_privy_uid?: unknown;
}) {
  return identity.privy_verified === true
    && typeof identity.rmt_privy_uid === "string"
    && identity.rmt_privy_uid.length > 0;
}

export function isVerifiedCommunityMember(identity: Parameters<typeof isVerifiedRmtIdentity>[0]) {
  return isVerifiedRmtIdentity(identity);
}

export function isRmtAdminIdentity(
  identity: Parameters<typeof isVerifiedRmtIdentity>[0] & { email?: unknown },
  adminEmail: string
) {
  return isVerifiedRmtIdentity(identity)
    && identity.email_verified === true
    && typeof identity.email === "string"
    && identity.email.toLowerCase() === adminEmail.toLowerCase();
}
