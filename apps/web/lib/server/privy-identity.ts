import { createHash } from "node:crypto";
import { verifyIdentityToken, type User as PrivyUser } from "@privy-io/node";

const PRIVY_FIREBASE_UID_PREFIX = "rmt_privy_";

export function privyIdentityConfiguration() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";
  const verificationKey = (process.env.PRIVY_VERIFICATION_KEY ?? "")
    .replaceAll("\\n", "\n")
    .trim();
  return appId && verificationKey ? { appId, verificationKey } : null;
}

export function firebaseUidForPrivyUser(privyUserId: string) {
  return `${PRIVY_FIREBASE_UID_PREFIX}${createHash("sha256").update(privyUserId).digest("hex")}`;
}

export function verifiedPrivyEmail(user: Pick<PrivyUser, "linked_accounts">) {
  const directEmail = user.linked_accounts.find((account) => account.type === "email");
  if (directEmail?.type === "email" && directEmail.verified_at > 0) {
    return directEmail.address.trim().toLowerCase();
  }
  const googleEmail = user.linked_accounts.find((account) => account.type === "google_oauth");
  if (googleEmail?.type === "google_oauth" && googleEmail.verified_at > 0) {
    return googleEmail.email.trim().toLowerCase();
  }
  return "";
}

export async function verifyPrivyIdentity(identityToken: string) {
  const configuration = privyIdentityConfiguration();
  if (!configuration) throw new Error("privy_identity_not_configured");
  return verifyIdentityToken({
    identity_token: identityToken,
    app_id: configuration.appId,
    verification_key: configuration.verificationKey
  });
}
