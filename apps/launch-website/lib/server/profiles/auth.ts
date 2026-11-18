import { timingSafeEqual } from "node:crypto";
import { getAddress, recoverMessageAddress, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { profileAddress, profileDeleteStatement, profileSignInStatement, type ProfileChallenge } from "../../profiles";
import { ProfileError, type ProfileConfig } from "./config";
import type { profileFirebase } from "./firebase";
import { digest, ensureWalletProfile, profileBudget, profileCollections as c, randomToken, walletKey, type ProfileAccount, type StoredSession } from "./store";

type Firebase = ReturnType<typeof profileFirebase>;
export const sessionCookieName = "rmt_launch_session_v1";
export const browserCookieName = "rmt_launch_browser_v1";
const sessionLifetime = 24 * 60 * 60 * 1_000;
const nonceLifetime = 5 * 60 * 1_000;
export type AuthenticatedProfile = { id: string; session: StoredSession; account: ProfileAccount };

export function cookieValue(request: Request, name: string): string | null {
  const text = request.headers.get("cookie") ?? "";
  if (text.length > 16_384) throw new ProfileError(400, "invalid_cookie", "Invalid session cookies.");
  const found = text.split(";").map(part => part.trim()).filter(part => part.startsWith(name + "="));
  if (found.length > 1) throw new ProfileError(400, "invalid_cookie", "Invalid session cookies.");
  return found[0]?.slice(name.length + 1) ?? null;
}
export function profileCookie(config: ProfileConfig, name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.secureCookies ? "; Secure" : ""}`;
}
function browserValue(request: Request) {
  const value = cookieValue(request, browserCookieName);
  if (value !== null && !/^[a-f0-9]{64}$/.test(value)) throw new ProfileError(400, "invalid_cookie", "Invalid browser binding.");
  return value;
}
export function requireCsrf(request: Request, auth: AuthenticatedProfile) {
  const supplied = request.headers.get("x-csrf-token");
  const expected = auth.session.csrfToken;
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied) || !/^[a-f0-9]{64}$/.test(expected)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new ProfileError(403, "csrf_rejected", "Refresh the profile page before trying again.");
}

export async function authenticatedProfile(request: Request, firebase: Firebase): Promise<AuthenticatedProfile | null> {
  const cookie = cookieValue(request, sessionCookieName);
  const browser = browserValue(request);
  if (!cookie || !browser || cookie.length > 8_192) return null;
  let decoded;
  try { decoded = await firebase.auth.verifySessionCookie(cookie, true); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (["auth/argument-error", "auth/invalid-session-cookie", "auth/session-cookie-expired", "auth/session-cookie-revoked", "auth/user-disabled", "auth/user-not-found"].includes(code ?? "")) return null;
    throw error;
  }
  const id = digest(cookie);
  return firebase.db.runTransaction(async tx => {
    const session = (await tx.get(firebase.db.collection(c.sessions).doc(id))).data() as StoredSession | undefined;
    if (!session || session.uid !== decoded.uid || session.browserHash !== digest(browser) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now()
        || decoded.rmt_launch_address !== session.walletAddress || decoded.rmt_launch_chain_id !== 4663) return null;
    const [accountRow, browserRow, bindingRow] = await tx.getAll(firebase.db.collection(c.accounts).doc(session.uid),
      firebase.db.collection(c.browsers).doc(session.browserHash), firebase.db.collection(c.wallets).doc(walletKey(session.walletAddress)));
    const account = accountRow.data() as ProfileAccount | undefined;
    if (!account || account.uid !== session.uid || account.walletAddress !== session.walletAddress || account.authEpoch !== session.epoch
        || account.deletedAt || browserRow.data()?.epoch !== session.browserEpoch || bindingRow.data()?.uid !== session.uid) return null;
    return { id, session, account };
  });
}
export async function requireAuthentication(request: Request, firebase: Firebase) {
  const auth = await authenticatedProfile(request, firebase);
  if (!auth) throw new ProfileError(401, "profile_sign_in_required", "Sign in to manage this profile.");
  return auth;
}

export async function issueChallenge(request: Request, firebase: Firebase, config: ProfileConfig, value: Record<string, unknown>) {
  if (Object.keys(value).some(key => !["address", "chainId", "purpose"].includes(key)) || value.chainId !== 4663) throw new ProfileError(400, "invalid_challenge", "Choose Robinhood Chain 4663.");
  const address = profileAddress(value.address);
  const purpose = value.purpose ?? "login";
  if (purpose !== "login" && purpose !== "delete-profile") throw new ProfileError(400, "invalid_challenge", "Invalid authentication purpose.");
  let original: AuthenticatedProfile | null = null;
  if (purpose === "delete-profile") {
    original = await requireAuthentication(request, firebase); requireCsrf(request, original);
    if (original.account.walletAddress !== address) throw new ProfileError(403, "wallet_mismatch", "Use the signed-in wallet.");
  }
  const prior = browserValue(request);
  const browser = prior ?? randomToken();
  const browserHash = digest(browser);
  await profileBudget(firebase.db, "nonce-origin", config.origin, 120);
  await profileBudget(firebase.db, "nonce-browser", browserHash, 12);
  const nonce = randomToken();
  const now = Date.now();
  const expiresAt = new Date(now + nonceLifetime).toISOString();
  const message = createSiweMessage({ address, chainId: 4663, domain: new URL(config.origin).host, uri: config.origin, version: "1", nonce,
    statement: purpose === "login" ? profileSignInStatement : profileDeleteStatement, issuedAt: new Date(now), expirationTime: new Date(expiresAt) });
  await firebase.db.runTransaction(async tx => {
    const browserRef = firebase.db.collection(c.browsers).doc(browserHash);
    const row = (await tx.get(browserRef)).data();
    const epoch = row?.epoch ?? 1;
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("Invalid browser epoch");
    const priorNonce = row?.lastNonce;
    if (priorNonce !== undefined && (typeof priorNonce !== "string" || !/^[a-f0-9]{64}$/.test(priorNonce))) throw new Error("Invalid browser challenge index");
    if (!row) tx.create(browserRef, { epoch, createdAt: now, expiresAt: now + 31 * 86_400_000, lastNonce: digest(nonce) });
    else tx.update(browserRef, { lastNonce: digest(nonce), expiresAt: now + 31 * 86_400_000 });
    if (priorNonce) tx.delete(firebase.db.collection(c.nonces).doc(priorNonce));
    tx.create(firebase.db.collection(c.nonces).doc(digest(nonce)), { message, address, chainId: 4663, purpose, browserHash, browserEpoch: epoch,
      expiresAt: now + nonceLifetime, createdAt: now, consumedAt: null, sessionId: original?.id ?? null });
  });
  return { challenge: { message, nonce, expiresAt, purpose } as ProfileChallenge, browserCookie: profileCookie(config, browserCookieName, browser, 30 * 86_400) };
}

export async function verifyChallenge(request: Request, firebase: Firebase, config: ProfileConfig, value: Record<string, unknown>): Promise<{ cookie: string | null; reauthExpiresAt?: string }> {
  if (Object.keys(value).some(key => !["message", "signature"].includes(key)) || typeof value.message !== "string" || value.message.length > 2_048
      || typeof value.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value.signature)) throw new ProfileError(400, "invalid_signature", "A standard wallet message signature is required.");
  const browser = browserValue(request);
  if (!browser) throw new ProfileError(401, "challenge_expired", "Request a new sign-in message.");
  const browserHash = digest(browser);
  await profileBudget(firebase.db, "verify-origin", config.origin, 120);
  await profileBudget(firebase.db, "verify-browser", browserHash, 20);
  const parsed = parseSiweMessage(value.message);
  if (!parsed.nonce || !/^[a-f0-9]{64}$/.test(parsed.nonce) || parsed.domain !== new URL(config.origin).host || parsed.uri !== config.origin || parsed.chainId !== 4663 || parsed.version !== "1") {
    throw new ProfileError(401, "invalid_signature", "The signed message does not match this site and network.");
  }
  let recovered;
  try { recovered = await recoverMessageAddress({ message: value.message, signature: value.signature as Hex }); }
  catch { throw new ProfileError(401, "invalid_signature", "The wallet signature could not be verified."); }
  try { if (!parsed.address || getAddress(parsed.address) !== recovered) throw new Error("Wrong account"); }
  catch { throw new ProfileError(401, "invalid_signature", "The wallet signature does not match the account."); }
  const nonceRef = firebase.db.collection(c.nonces).doc(digest(parsed.nonce));
  const proof = await firebase.db.runTransaction(async tx => {
    const nonce = (await tx.get(nonceRef)).data();
    const browserRow = (await tx.get(firebase.db.collection(c.browsers).doc(browserHash))).data();
    if (!nonce || nonce.message !== value.message || nonce.address !== recovered || nonce.browserHash !== browserHash || nonce.browserEpoch !== browserRow?.epoch
        || nonce.consumedAt !== null || nonce.expiresAt <= Date.now()) throw new ProfileError(401, "challenge_expired", "This sign-in message expired or was already used.");
    tx.update(nonceRef, { consumedAt: Date.now() });
    return nonce;
  });
  if (proof.purpose === "delete-profile") {
    const original = await requireAuthentication(request, firebase); requireCsrf(request, original);
    if (proof.sessionId !== original.id || proof.address !== original.account.walletAddress) throw new ProfileError(401, "challenge_expired", "Request a new profile-removal confirmation.");
    const until = Date.now() + 120_000;
    await firebase.db.runTransaction(async tx => {
      const [sessionRow, browserRow] = await tx.getAll(firebase.db.collection(c.sessions).doc(original.id), firebase.db.collection(c.browsers).doc(browserHash));
      if (!sessionRow.exists || browserRow.data()?.epoch !== proof.browserEpoch) throw new ProfileError(401, "challenge_expired", "The profile session changed.");
      tx.update(sessionRow.ref, { reauthUntil: until });
    });
    return { reauthExpiresAt: new Date(until).toISOString(), cookie: null };
  }
  const identity = await ensureWalletProfile(firebase.db, proof.address);
  try { await firebase.auth.getUser(identity.uid); }
  catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    try { await firebase.auth.createUser({ uid: identity.uid }); }
    catch (createError) { if ((createError as { code?: string }).code !== "auth/uid-already-exists") throw createError; }
  }
  // No global custom-claim mutation or legacy Auth-user deletion. Claims belong to this sign-in token.
  const customToken = await firebase.auth.createCustomToken(identity.uid, { rmt_launch_address: identity.walletAddress, rmt_launch_chain_id: 4663, rmt_launch_login_nonce: digest(parsed.nonce) });
  const exchanged = await fetch(`${config.authRestOrigin}/v1/accounts:signInWithCustomToken?key=${config.webApiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(10_000),
  });
  if (!exchanged.ok) throw new Error("Firebase token exchange unavailable");
  const body = await exchanged.json() as { idToken?: string };
  if (typeof body.idToken !== "string" || body.idToken.length > 16_384) throw new Error("Invalid Firebase token response");
  const decoded = await firebase.auth.verifyIdToken(body.idToken);
  if (decoded.uid !== identity.uid || decoded.rmt_launch_address !== identity.walletAddress || decoded.rmt_launch_chain_id !== 4663) throw new Error("Firebase profile token identity mismatch");
  const cookie = await firebase.auth.createSessionCookie(body.idToken, { expiresIn: sessionLifetime });
  await firebase.db.runTransaction(async tx => {
    const [browserRow, accountRow] = await tx.getAll(firebase.db.collection(c.browsers).doc(browserHash), firebase.db.collection(c.accounts).doc(identity.uid));
    if (browserRow.data()?.epoch !== proof.browserEpoch || accountRow.data()?.authEpoch !== identity.authEpoch) throw new ProfileError(401, "challenge_expired", "The browser session changed; sign in again.");
    const priorIds: unknown = accountRow.data()?.sessionIds ?? [];
    if (!Array.isArray(priorIds) || priorIds.length > 8 || priorIds.some(id => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))) throw new Error("Invalid app session index");
    const expiredIds = priorIds.slice(0, Math.max(0, priorIds.length - 7)) as string[];
    const expired = expiredIds.length ? await tx.getAll(...expiredIds.map(id => firebase.db.collection(c.sessions).doc(id))) : [];
    if (expired.some(row => row.exists && row.data()?.uid !== identity.uid)) throw new Error("App session ownership mismatch");
    for (const row of expired) tx.delete(row.ref);
    const id = digest(cookie);
    tx.create(firebase.db.collection(c.sessions).doc(id), { uid: identity.uid, walletAddress: identity.walletAddress, browserHash, browserEpoch: proof.browserEpoch,
      csrfToken: randomToken(), epoch: identity.authEpoch, expiresAt: Date.now() + sessionLifetime, reauthUntil: 0 });
    tx.update(accountRow.ref, { sessionIds: [...priorIds.slice(-7), id] });
  });
  return { cookie: profileCookie(config, sessionCookieName, cookie, sessionLifetime / 1_000) };
}

export async function logOut(request: Request, firebase: Firebase, config: ProfileConfig) {
  const auth = await authenticatedProfile(request, firebase);
  if (auth) requireCsrf(request, auth);
  const browser = browserValue(request);
  if (browser) await firebase.db.runTransaction(async tx => {
    const ref = firebase.db.collection(c.browsers).doc(digest(browser));
    const row = (await tx.get(ref)).data();
    tx.set(ref, { epoch: (row?.epoch ?? 0) + 1, loggedOutAt: Date.now() }, { merge: true });
    if (auth) tx.delete(firebase.db.collection(c.sessions).doc(auth.id));
  });
  return [profileCookie(config, sessionCookieName, "", 0), profileCookie(config, browserCookieName, "", 0)];
}
