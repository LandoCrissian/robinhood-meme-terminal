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
