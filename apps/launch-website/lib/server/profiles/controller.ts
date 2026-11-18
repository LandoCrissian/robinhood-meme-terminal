import { profileAddress, profileEdit, profileUsername, type AccountSession } from "../../profiles";
import { authenticatedProfile, browserCookieName, issueChallenge, logOut, profileCookie, requireAuthentication, requireCsrf, sessionCookieName, verifyChallenge } from "./auth";
import { readAvatar, sanitizeAvatar, saveAvatar, maximumAvatarUploadBytes } from "./avatar";
import { profileConfig, ProfileError, requireProfileRequest } from "./config";
import { profileFirebase } from "./firebase";
import { accountProfile, deleteProfile, profileBudget, profileCollections, publicProfile, updateProfile } from "./store";
import { cleanupExpiredProfileState } from "./retention";

export type AccountAction = "session" | "nonce" | "verify" | "logout" | "profile" | "avatar" | "public-wallet" | "public-username" | "public-avatar";
export function accountJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Vary": "Cookie, Origin" } });
}
async function boundedBytes(request: Request, maximum: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new ProfileError(413, "request_too_large", "This profile request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const pieces: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new ProfileError(413, "request_too_large", "This profile request is too large."); }
      pieces.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(bytes); let cursor = 0;
  for (const part of pieces) { result.set(part, cursor); cursor += part.byteLength; }
  return result;
}
async function jsonBody(request: Request) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new ProfileError(415, "json_required", "Send a JSON profile request.");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(request, 8_192)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON object");
    return parsed as Record<string, unknown>;
  } catch (error) { if (error instanceof ProfileError) throw error; throw new ProfileError(400, "invalid_profile_request", "Invalid profile request."); }
}
function validated<T>(run: () => T): T {
  try { return run(); }
  catch (error) { if (error instanceof ProfileError) throw error; throw new ProfileError(400, "invalid_profile_fields", error instanceof Error ? error.message : "Invalid profile fields."); }
}
const methods: Record<AccountAction, string[]> = { session: ["GET", "HEAD"], nonce: ["POST"], verify: ["POST"], logout: ["POST"],
  profile: ["GET", "HEAD", "PATCH", "DELETE"], avatar: ["POST"], "public-wallet": ["GET", "HEAD"], "public-username": ["GET", "HEAD"], "public-avatar": ["GET", "HEAD"] };

export async function accountHandler(request: Request, action: AccountAction, key?: string): Promise<Response> {
  try {
    if (!methods[action].includes(request.method)) return accountJson({ error: "Method not allowed." }, 405);
    const config = profileConfig();
    if (!config) return action === "session" ? accountJson({ authenticated: false, availability: "disabled" } satisfies AccountSession)
      : accountJson({ availability: "disabled", error: "Wallet profiles are not enabled in this environment." }, 404);
    requireProfileRequest(request, config, !["GET", "HEAD"].includes(request.method));
    const search = new URL(request.url).searchParams;
    if ((action !== "public-avatar" && search.size !== 0) || (action === "public-avatar" && (search.size > 1 || (search.size === 1 && (!search.has("v") || !/^[a-f0-9]{64}$/.test(search.get("v")!)))))) throw new ProfileError(400, "invalid_profile_query", "Invalid profile query.");
    const firebase = await profileFirebase(config);
    if (!["GET", "HEAD"].includes(request.method)) {
      try { await cleanupExpiredProfileState(firebase.db); }
      catch { console.warn(JSON.stringify({ event: "profile_retention_deferred" })); }
    }
    if (action === "session") {
      const auth = await authenticatedProfile(request, firebase);
      if (!auth) return accountJson({ authenticated: false, availability: "available" } satisfies AccountSession);
      return accountJson({ authenticated: true, availability: "available", account: { walletAddress: profileAddress(auth.account.walletAddress), chainId: 4663,
        profile: await accountProfile(firebase.db, auth.account) }, csrfToken: auth.session.csrfToken } satisfies AccountSession);
    }
    if (action === "nonce") {
      const body = await jsonBody(request); validated(() => profileAddress(body.address));
      const result = await issueChallenge(request, firebase, config, body);
      const response = accountJson(result.challenge);
      if (result.browserCookie) response.headers.append("Set-Cookie", result.browserCookie);
      return response;
    }
    if (action === "verify") {
      const verified = await verifyChallenge(request, firebase, config, await jsonBody(request));
      const response = accountJson({ ok: true, ...(verified.reauthExpiresAt ? { reauthExpiresAt: verified.reauthExpiresAt } : {}) });
      if (verified.cookie) response.headers.append("Set-Cookie", verified.cookie);
      return response;
    }
    if (action === "logout") {
      const response = accountJson({ ok: true });
      for (const cookie of await logOut(request, firebase, config)) response.headers.append("Set-Cookie", cookie);
      return response;
    }
    if (action === "public-wallet" || action === "public-username") {
      await profileBudget(firebase.db, "public-lookup", config.origin, 120);
      let address: string;
      if (action === "public-wallet") address = validated(() => profileAddress(key));
      else {
        const username = validated(() => profileUsername(key));
        if (!username) throw new ProfileError(404, "profile_not_found", "No public profile was found.");
        const binding = (await firebase.db.collection(profileCollections.usernames).doc(username).get()).data();
        if (!binding?.walletAddress) return accountJson({ profile: null, availability: "available" }, 404);
        address = profileAddress(binding.walletAddress);
      }
      const profile = await publicProfile(firebase.db, address);
      return accountJson({ profile, availability: "available" }, profile ? 200 : 404);
    }
    if (action === "public-avatar") {
      const address = validated(() => profileAddress(key));
      await profileBudget(firebase.db, "avatar-read", config.origin, 180);
      const image = await readAvatar(firebase.db, address, search.get("v"));
      if (!image) return accountJson({ error: "Avatar not found." }, 404);
      return new Response(request.method === "HEAD" ? null : new Uint8Array(image.bytes), { headers: { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Length": String(image.bytes.length), "ETag": '"' + image.sha256 + '"',
        "Cache-Control": "public, max-age=60, must-revalidate" } });
    }
    const auth = await requireAuthentication(request, firebase);
    if (action === "profile" && ["GET", "HEAD"].includes(request.method)) return accountJson({ profile: await accountProfile(firebase.db, auth.account) });
    requireCsrf(request, auth);
    await profileBudget(firebase.db, action, auth.account.uid, action === "avatar" ? 6 : 30);
    const guard = { sessionId: auth.id, browserHash: auth.session.browserHash, browserEpoch: auth.session.browserEpoch };
    if (action === "profile" && request.method === "PATCH") {
      const fields = await jsonBody(request);
      return accountJson({ profile: await updateProfile(firebase.db, auth.account, validated(() => profileEdit(fields)), guard) });
    }
    if (action === "profile" && request.method === "DELETE") {
      await deleteProfile(firebase.db, auth.account, auth.id, auth.session.browserHash, auth.session.browserEpoch);
      const response = accountJson({ deleted: true, scope: "RMT Launch profile only; blockchain records, Firebase identity and legacy records are preserved." });
      response.headers.append("Set-Cookie", profileCookie(config, sessionCookieName, "", 0));
      response.headers.append("Set-Cookie", profileCookie(config, browserCookieName, "", 0));
      return response;
    }
    if (action === "avatar") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.startsWith("multipart/form-data;")) throw new ProfileError(415, "image_required", "Choose an image file.");
      const form = await new Response(await boundedBytes(request, maximumAvatarUploadBytes + 16_384), { headers: { "Content-Type": contentType } }).formData();
      if (Array.from(form.keys()).some(name => name !== "file") || form.getAll("file").length !== 1) throw new ProfileError(400, "image_required", "Upload one image file.");
      const file = form.get("file");
      if (!file || typeof file === "string" || file.size > maximumAvatarUploadBytes) throw new ProfileError(413, "avatar_too_large", "Use an image smaller than 2 MiB.");
      const image = await sanitizeAvatar(new Uint8Array(await file.arrayBuffer()), file.type);
      await saveAvatar(firebase.db, auth.account, image, guard);
      return accountJson({ profile: await accountProfile(firebase.db, auth.account) });
    }
    return accountJson({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof ProfileError) {
      const response = accountJson({ error: error.message, code: error.code, ...(action === "session" ? { authenticated: false, availability: "unavailable" } : {}) }, error.status);
      if (error.status === 429) response.headers.set("Retry-After", "60");
      return response;
    }
    // No cookies, signed messages, credentials, identifiers or profile contents enter logs.
    console.error(JSON.stringify({ event: "profile_service_unavailable", errorType: error instanceof Error ? error.name : "unknown" }));
    return accountJson({ error: "Profile services are unavailable. Please retry later.", code: "profile_backend_unavailable", availability: "unavailable", ...(action === "session" ? { authenticated: false } : {}) }, 503);
  }
}
