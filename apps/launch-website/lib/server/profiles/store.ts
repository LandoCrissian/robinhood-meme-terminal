import { createHash, randomBytes } from "node:crypto";
import type { DocumentData, Firestore, Transaction } from "firebase-admin/firestore";
import { profileAddress, profileEdit, type AccountProfile, type PublicCreatorProfile, type ProfileEdit } from "../../profiles";
import { ProfileError } from "./config";

export const profileCollections = {
  accounts: "rmtLaunchAccountsV1", wallets: "rmtLaunchWalletBindingsV1", public: "rmtLaunchPublicProfilesV1", private: "rmtLaunchProfilesV1",
  usernames: "rmtLaunchUsernamesV1", nonces: "rmtLaunchNoncesV1", sessions: "rmtLaunchSessionsV1", budgets: "rmtLaunchBudgetsV1", browsers: "rmtLaunchBrowsersV1", avatars: "rmtLaunchAvatarsV1",
} as const;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export const walletKey = (address: string) => "4663_" + profileAddress(address).toLowerCase();
export type ProfileAccount = { uid: string; walletAddress: string; authEpoch: number; avatarId?: string; sessionIds?: string[]; createdAt: string; deletedAt?: string };
export type StoredSession = { uid: string; walletAddress: string; browserHash: string; browserEpoch: number; csrfToken: string; epoch: number; expiresAt: number; reauthUntil: number };
export type WriteAuthorization = { sessionId: string; browserHash: string; browserEpoch: number };
const defaults = { theme: "dark" as const, reducedMotion: false };

export async function profileBudget(db: Firestore, action: string, key: string, limit: number, now = Date.now()) {
  const ref = db.collection(profileCollections.budgets).doc(digest(action + ":" + key));
  await db.runTransaction(async tx => {
    const value = (await tx.get(ref)).data();
    const fresh = value && value.window === Math.floor(now / 60_000);
    const count = fresh ? Number(value.count) : 0;
    if (!Number.isSafeInteger(count) || count >= limit) throw new ProfileError(429, "profile_rate_limited", "Please wait before trying again.");
    tx.set(ref, { window: Math.floor(now / 60_000), count: count + 1, expiresAt: now + 120_000 });
  });
}

/** A wallet can reuse an explicitly linked UID; no legacy Privy/email ownership is inferred or modified. */
export async function ensureWalletProfile(db: Firestore, address: string, now = Date.now()) {
  const wallet = profileAddress(address);
  const walletRef = db.collection(profileCollections.wallets).doc(walletKey(wallet));
  return db.runTransaction(async tx => {
    const binding = (await tx.get(walletRef)).data();
    const uid = binding?.uid ?? "rmt_launch_4663_" + wallet.slice(2).toLowerCase();
    if (typeof uid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid) || (binding && (binding.walletAddress !== wallet || binding.chainId !== 4663))) throw new ProfileError(409, "profile_link_conflict", "This wallet needs authenticated account recovery.");
    const accountRef = db.collection(profileCollections.accounts).doc(uid);
    const publicRef = db.collection(profileCollections.public).doc(wallet.toLowerCase());
    const privateRef = db.collection(profileCollections.private).doc(uid);
    const [accountRow, publicRow, privateRow] = await tx.getAll(accountRef, publicRef, privateRef);
    const account = accountRow.data() as ProfileAccount | undefined;
    if (account && (account.uid !== uid || account.walletAddress !== wallet || !Number.isSafeInteger(account.authEpoch))) throw new ProfileError(409, "profile_link_conflict", "This wallet needs authenticated account recovery.");
    const stamp = new Date(now).toISOString();
    if (!binding) tx.create(walletRef, { uid, walletAddress: wallet, chainId: 4663, linkedAt: stamp, linkage: "wallet-native" });
    if (!account) tx.create(accountRef, { uid, walletAddress: wallet, authEpoch: 1, createdAt: stamp });
    else if (account.deletedAt) tx.set(accountRef, { uid, walletAddress: wallet, authEpoch: account.authEpoch, createdAt: stamp });
    if (!publicRow.exists) tx.create(publicRef, { walletAddress: wallet, chainId: 4663, username: null, displayName: "", bio: "", links: [], avatarUrl: null, createdAt: stamp, updatedAt: stamp });
    if (!privateRow.exists) tx.create(privateRef, { preferences: defaults, createdAt: stamp, updatedAt: stamp });
    return { uid, walletAddress: wallet, authEpoch: account?.authEpoch ?? 1 };
  });
}

function publicView(value: DocumentData | undefined, address: string): PublicCreatorProfile | null {
  if (!value) return null;
  const wallet = profileAddress(address);
  if (value.walletAddress !== wallet || value.chainId !== 4663 || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") throw new Error("Invalid stored public profile");
  const fields = profileEdit({ username: value.username, displayName: value.displayName, bio: value.bio, links: value.links, preferences: defaults });
  const avatarUrl = value.avatarUrl;
  if (avatarUrl !== null && (typeof avatarUrl !== "string" || !avatarUrl.startsWith("/api/account/avatar/" + wallet + "?v=")
      || !/^[a-f0-9]{64}$/.test(avatarUrl.slice(("/api/account/avatar/" + wallet + "?v=").length)))) throw new Error("Invalid stored avatar binding");
  return { walletAddress: wallet, chainId: 4663, username: fields.username, displayName: fields.displayName, bio: fields.bio, links: fields.links, avatarUrl,
    createdAt: value.createdAt, updatedAt: value.updatedAt };
}
export async function publicProfile(db: Firestore, address: string) {
  return publicView((await db.collection(profileCollections.public).doc(profileAddress(address).toLowerCase()).get()).data(), address);
}
export async function accountProfile(db: Firestore, account: ProfileAccount): Promise<AccountProfile> {
  const [visible, privateRow] = await Promise.all([publicProfile(db, account.walletAddress), db.collection(profileCollections.private).doc(account.uid).get()]);
  if (!visible || !privateRow.exists) throw new ProfileError(401, "profile_session_expired", "Sign in again.");
  const preferences = privateRow.data()?.preferences;
  // Public fields are selected explicitly; private preferences never enter the public projection.
  return { ...visible, preferences: profileEdit({ username: visible.username, displayName: visible.displayName, bio: visible.bio, links: visible.links, preferences }).preferences };
}

export async function assertWriteSession(tx: Transaction, db: Firestore, account: ProfileAccount, guard: WriteAuthorization) {
  const [sessionRow, browserRow] = await tx.getAll(db.collection(profileCollections.sessions).doc(guard.sessionId), db.collection(profileCollections.browsers).doc(guard.browserHash));
  const session = sessionRow.data() as StoredSession | undefined;
  if (!session || session.uid !== account.uid || session.walletAddress !== account.walletAddress || session.epoch !== account.authEpoch
      || session.browserHash !== guard.browserHash || session.browserEpoch !== guard.browserEpoch || browserRow.data()?.epoch !== guard.browserEpoch
      || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now()) throw new ProfileError(401, "profile_session_expired", "The profile session changed; sign in again.");
}

export async function updateProfile(db: Firestore, account: ProfileAccount, edit: ProfileEdit, guard: WriteAuthorization, now = Date.now()) {
  const publicRef = db.collection(profileCollections.public).doc(account.walletAddress.toLowerCase());
  const privateRef = db.collection(profileCollections.private).doc(account.uid);
  await db.runTransaction(async tx => {
    const [currentRow, internalRow] = await tx.getAll(publicRef, db.collection(profileCollections.accounts).doc(account.uid));
    const current = publicView(currentRow.data(), account.walletAddress);
    if (!current || internalRow.data()?.authEpoch !== account.authEpoch) throw new ProfileError(401, "profile_session_expired", "Sign in again.");
    await assertWriteSession(tx, db, account, guard);
    const nextRef = edit.username ? db.collection(profileCollections.usernames).doc(edit.username) : null;
    const oldRef = current.username ? db.collection(profileCollections.usernames).doc(current.username) : null;
    const next = nextRef ? (await tx.get(nextRef)).data() : undefined;
    const old = oldRef ? (await tx.get(oldRef)).data() : undefined;
    if (next && (next.uid !== account.uid || next.walletAddress !== account.walletAddress)) throw new ProfileError(409, "username_taken", "That username is already in use.");
    if (old && (old.uid !== account.uid || old.walletAddress !== account.walletAddress)) throw new ProfileError(409, "profile_link_conflict", "Profile ownership needs recovery.");
    const stamp = new Date(now).toISOString();
    if (oldRef && current.username !== edit.username) tx.delete(oldRef);
    if (nextRef) tx.set(nextRef, { uid: account.uid, walletAddress: account.walletAddress });
    tx.set(publicRef, { ...current, username: edit.username, displayName: edit.displayName, bio: edit.bio, links: edit.links, updatedAt: stamp });
    tx.set(privateRef, { preferences: edit.preferences, updatedAt: stamp }, { merge: true });
  });
  return accountProfile(db, account);
}

export async function deleteProfile(db: Firestore, account: ProfileAccount, sessionId: string, browserHash: string, browserEpoch: number) {
  await db.runTransaction(async tx => {
    const accountRef = db.collection(profileCollections.accounts).doc(account.uid);
    const publicRef = db.collection(profileCollections.public).doc(account.walletAddress.toLowerCase());
    const [internalRow, visibleRow, sessionRow, browserRow] = await tx.getAll(accountRef, publicRef,
      db.collection(profileCollections.sessions).doc(sessionId), db.collection(profileCollections.browsers).doc(browserHash));
    const internal = internalRow.data() as ProfileAccount | undefined;
    const visible = publicView(visibleRow.data(), account.walletAddress);
    if (!internal || internal.authEpoch !== account.authEpoch || browserRow.data()?.epoch !== browserEpoch || typeof sessionRow.data()?.reauthUntil !== "number" || sessionRow.data()!.reauthUntil <= Date.now()
        || sessionRow.data()?.uid !== account.uid || sessionRow.data()?.browserHash !== browserHash || sessionRow.data()?.browserEpoch !== browserEpoch
        || sessionRow.data()?.epoch !== account.authEpoch || sessionRow.data()!.expiresAt <= Date.now()) throw new ProfileError(403, "recent_sign_in_required", "Confirm profile removal with your wallet first.");
    const usernameRef = visible?.username ? db.collection(profileCollections.usernames).doc(visible.username) : null;
    const avatarRef = internal.avatarId ? db.collection(profileCollections.avatars).doc(internal.avatarId) : null;
    const username = usernameRef ? (await tx.get(usernameRef)).data() : null;
    const avatar = avatarRef ? (await tx.get(avatarRef)).data() : null;
    if ((username && username.uid !== account.uid) || (avatar && avatar.uid !== account.uid)) throw new ProfileError(409, "profile_link_conflict", "Profile ownership needs recovery.");
    const ids = internal.sessionIds ?? [sessionId];
    if (ids.length > 8 || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error("Invalid app session index");
    const sessions = ids.length ? await tx.getAll(...ids.map(id => db.collection(profileCollections.sessions).doc(id))) : [];
    if (sessions.some(row => row.exists && row.data()?.uid !== account.uid)) throw new Error("App session ownership mismatch");
    for (const row of sessions) tx.delete(row.ref);
    tx.delete(db.collection(profileCollections.sessions).doc(sessionId));
    if (usernameRef) tx.delete(usernameRef);
    if (avatarRef) tx.delete(avatarRef);
    tx.delete(publicRef);
    tx.delete(db.collection(profileCollections.private).doc(account.uid));
    tx.update(browserRow.ref, { epoch: browserEpoch + 1, loggedOutAt: Date.now() });
    // Minimal identity/epoch tombstone prevents replay. Legacy users/Auth and every on-chain/indexer record are untouched.
    tx.set(accountRef, { uid: account.uid, walletAddress: account.walletAddress, authEpoch: account.authEpoch + 1, createdAt: account.createdAt, deletedAt: new Date().toISOString() });
  });
}
