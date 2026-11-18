export type ProfileConfig = { mode: "emulator" | "cloud"; origin: string; projectId: "demo-rmt-launch-profiles" | "robinhood-meme-terminal";
  authHost: string | null; firestoreHost: string | null; storageHost: string | null; authRestOrigin: string; webApiKey: string; secureCookies: boolean };
export class ProfileError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const unavailable = () => new ProfileError(503, "profile_backend_unavailable", "Profile services are unavailable.");
function localHost(value: string | undefined) {
  if (!value || !/^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(value) || Number(value.split(":")[1]) > 65_535) throw unavailable();
  return value;
}
/** Cloud capability is inactive unless separately owner-approved and configured with the existing project. */
export function profileConfig(env: Record<string, string | undefined> = process.env): ProfileConfig | null {
  if (!env.RMT_PROFILES_MODE) return null;
  if (env.RMT_PROFILES_MODE === "approved-existing-firebase-v1") {
    if (env.RMT_PROFILES_ACTIVATION_APPROVAL !== "owner-approved-existing-firebase-profiles-v1"
        || env.RMT_PROFILES_ORIGIN !== "https://www.rmtlaunch.fun" || env.GCLOUD_PROJECT !== "robinhood-meme-terminal"
        || env.RMT_FIREBASE_WEB_APP_ID !== "1:737255919447:web:8674f28ee2486a0b983812"
        || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST || env.STORAGE_EMULATOR_HOST
        || !/^AIza[0-9A-Za-z_-]{30,64}$/.test(env.RMT_FIREBASE_WEB_API_KEY ?? "")
        || !env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_JSON.length > 16_384) throw unavailable();
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
    if (account.project_id !== "robinhood-meme-terminal" || typeof account.client_email !== "string" || typeof account.private_key !== "string") throw unavailable();
    return { mode: "cloud", origin: "https://www.rmtlaunch.fun", projectId: "robinhood-meme-terminal", authHost: null, firestoreHost: null, storageHost: null,
      authRestOrigin: "https://identitytoolkit.googleapis.com", webApiKey: env.RMT_FIREBASE_WEB_API_KEY!, secureCookies: true };
  }
  if (env.RMT_PROFILES_MODE !== "local-firebase-emulators-v1" || env.NETLIFY || env.VERCEL || env.DEPLOY_ID || env.CONTEXT || env.RAILWAY_ENVIRONMENT_ID) throw unavailable();
  const origin = new URL(env.RMT_PROFILES_ORIGIN ?? "https://invalid.example");
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw unavailable();
  if (env.GCLOUD_PROJECT !== "demo-rmt-launch-profiles" || (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== env.GCLOUD_PROJECT)) throw unavailable();
  const authHost = localHost(env.FIREBASE_AUTH_EMULATOR_HOST);
  const firestoreHost = localHost(env.FIRESTORE_EMULATOR_HOST);
  const storageHost = env.FIREBASE_STORAGE_EMULATOR_HOST ? localHost(env.FIREBASE_STORAGE_EMULATOR_HOST) : null;
  if (authHost === firestoreHost || (storageHost && [authHost, firestoreHost].includes(storageHost))) throw unavailable();
  if (env.STORAGE_EMULATOR_HOST && env.STORAGE_EMULATOR_HOST !== "http://" + storageHost) throw unavailable();
  return { mode: "emulator", origin: origin.origin, projectId: "demo-rmt-launch-profiles", authHost, firestoreHost, storageHost,
    authRestOrigin: "http://" + authHost + "/identitytoolkit.googleapis.com", webApiKey: "local-emulator-api-key", secureCookies: false };
}
export function requireProfileRequest(request: Request, config: ProfileConfig, mutation: boolean) {
  const url = new URL(request.url);
  const expected = new URL(config.origin);
  // NextRequest/NextURL canonicalize loopback IPv4 to "localhost" internally.
  // Only that internal local alias is permitted; the actual external Host and Origin stay exact.
  const nextLoopbackAlias = config.mode === "emulator" && expected.hostname === "127.0.0.1" && url.hostname === "localhost"
    && url.protocol === expected.protocol && url.port === expected.port;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const forwardedPort = request.headers.get("x-forwarded-port");
  if ((url.origin !== config.origin && !nextLoopbackAlias) || request.headers.get("host") !== expected.host
      || request.headers.has("forwarded") || (forwardedHost !== null && forwardedHost !== expected.host)
      || (forwardedProtocol !== null && forwardedProtocol !== expected.protocol.slice(0, -1))
      || (forwardedPort !== null && forwardedPort !== (expected.port || (expected.protocol === "https:" ? "443" : "80")))) {
    throw new ProfileError(403, "profile_origin_rejected", "The profile origin does not match this local environment.");
  }
  const origin = request.headers.get("origin");
  if ((mutation && origin !== config.origin) || (origin !== null && origin !== config.origin)
      || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
    throw new ProfileError(403, "profile_origin_rejected", "Use the same profile origin.");
  }
}

/** Routing allowlist only. Every handler repeats configuration, origin and session authorization. */
export function isProfileApiRoute(path: string, method: string) {
  if (["GET", "HEAD"].includes(method)) return ["/api/account/session", "/api/account/profile"].includes(path)
    || /^\/api\/account\/(?:creator|avatar)\/0x[0-9a-fA-F]{40}$/.test(path)
    || /^\/api\/account\/public\/[a-z][a-z0-9_]{2,23}$/.test(path);
  if (method === "POST") return ["/api/account/nonce", "/api/account/verify", "/api/account/logout", "/api/account/avatar"].includes(path);
  return method === "PATCH" && path === "/api/account/profile"
    || method === "DELETE" && ["/api/account/profile", "/api/account/avatar"].includes(path);
}
