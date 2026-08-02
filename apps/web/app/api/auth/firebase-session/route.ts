import { NextResponse } from "next/server";
import type { UserRecord } from "firebase-admin/auth";
import { getRmtAdminAuth } from "../../../../lib/server/firebase-admin";
import {
  firebaseUidForPrivyUser,
  verifiedPrivyEmail,
  verifyPrivyIdentity
} from "../../../../lib/server/privy-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

function identityToken(request: Request) {
  const token = request.headers.get("privy-id-token")?.trim() ?? "";
  return token.length >= 100 && token.length <= 16_384 ? token : "";
}

function missingUser(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && String((error as { code?: unknown }).code) === "auth/user-not-found"
  );
}

async function optionalFirebaseUser(
  lookup: () => Promise<UserRecord>
) {
  try {
    return await lookup();
  } catch (error) {
    if (!missingUser(error)) throw error;
    return null;
  }
}

async function findFirebaseUser(
  auth: NonNullable<ReturnType<typeof getRmtAdminAuth>>,
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

async function bindFirebaseUser(
  auth: NonNullable<ReturnType<typeof getRmtAdminAuth>>,
  privyUserId: string,
  email: string
) {
  let user = await findFirebaseUser(auth, privyUserId, email);
  const boundPrivyUserId = user?.customClaims?.rmt_privy_uid;
  if (typeof boundPrivyUserId === "string" && boundPrivyUserId !== privyUserId) {
    throw new Error("identity_already_bound");
  }
  if (user?.disabled) throw new Error("identity_disabled");

  if (!user) {
    user = await auth.createUser({
      uid: firebaseUidForPrivyUser(privyUserId),
      ...(email ? { email, emailVerified: true } : {})
    });
  } else if (email && (user.email !== email || !user.emailVerified)) {
    user = await auth.updateUser(user.uid, { email, emailVerified: true });
  }

  const claims = {
    ...(user.customClaims ?? {}),
    privy_verified: true,
    rmt_privy_uid: privyUserId
  };
  await auth.setCustomUserClaims(user.uid, claims);
  return { claims, user: user as UserRecord };
}

export async function POST(request: Request) {
  const token = identityToken(request);
  if (!token) {
    return NextResponse.json({ error: "RMT account identity required." }, { status: 401, headers: HEADERS });
  }
  const auth = getRmtAdminAuth();
  if (!auth) {
    return NextResponse.json({ error: "RMT profile sync is awaiting secure configuration." }, {
      status: 503,
      headers: { ...HEADERS, "Retry-After": "60" }
    });
  }

  try {
    const identity = await verifyPrivyIdentity(token);
    if (identity.is_guest) {
      return NextResponse.json({ error: "Finish RMT account sign-in before enabling cloud sync." }, {
        status: 403,
        headers: HEADERS
      });
    }
    const email = verifiedPrivyEmail(identity);
    const { claims, user } = await bindFirebaseUser(auth, identity.id, email);
    const firebaseToken = await auth.createCustomToken(user.uid, claims);
    return NextResponse.json({ firebaseToken }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof Error && error.message === "identity_already_bound") {
      return NextResponse.json({ error: "This RMT profile is already bound to another verified account." }, {
        status: 409,
        headers: HEADERS
      });
    }
    if (error instanceof Error && error.message === "identity_disabled") {
      return NextResponse.json({ error: "This RMT account is disabled." }, {
        status: 403,
        headers: HEADERS
      });
    }
    if (error instanceof Error && error.message === "privy_identity_not_configured") {
      return NextResponse.json({ error: "RMT profile sync is awaiting Privy verification configuration." }, {
        status: 503,
        headers: { ...HEADERS, "Retry-After": "60" }
      });
    }
    return NextResponse.json({ error: "RMT account verification failed. Sign in again and retry." }, {
      status: 401,
      headers: HEADERS
    });
  }
}
