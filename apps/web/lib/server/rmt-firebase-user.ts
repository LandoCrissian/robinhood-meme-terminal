import type { Auth, UserRecord } from "firebase-admin/auth";
import { firebaseUidForPrivyUser } from "./privy-identity";

function missingFirebaseUser(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && String((error as { code?: unknown }).code) === "auth/user-not-found"
  );
}

async function optionalFirebaseUser(lookup: () => Promise<UserRecord>) {
  try {
    return await lookup();
  } catch (error) {
    if (!missingFirebaseUser(error)) throw error;
    return null;
  }
}

export async function findRmtFirebaseUser(
  auth: Auth,
  privyUserId: string,
  email: string
) {
  const bridgeUid = firebaseUidForPrivyUser(privyUserId);
  const [bridgeUser, emailUser] = await Promise.all([
    optionalFirebaseUser(() => auth.getUser(bridgeUid)),
    email ? optionalFirebaseUser(() => auth.getUserByEmail(email)) : Promise.resolve(null)
  ]);
  if (emailUser) {
    const emailBinding = emailUser.customClaims?.rmt_privy_uid;
    if (typeof emailBinding === "string" && emailBinding !== privyUserId) {
      throw new Error("identity_already_bound");
    }
    // During the one-time migration, the verified email owner wins over an
    // orphan bridge UID so the existing RMT admin/profile is recovered.
    return emailUser;
  }
  return bridgeUser;
}
