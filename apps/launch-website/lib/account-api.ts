export class AccountApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly availability?: string) {
    super(code); this.name = "AccountApiError";
  }
}

export async function accountApi<T>(path: string, options: {
  method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; csrfToken?: string; signal?: AbortSignal;
} = {}): Promise<T> {
  if (!/^\/api\/account\/(?:session|nonce|verify|logout|profile|avatar|public\/[a-z][a-z0-9_]{2,23}|creator\/0x[0-9a-f]{40})$/i.test(path)) {
    throw new AccountApiError("invalid_request", 400);
  }
  const multipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(path, { method: options.method ?? "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { Accept: "application/json", ...(options.body === undefined || multipart ? {} : { "Content-Type": "application/json" }),
      ...(options.csrfToken ? { "X-CSRF-Token": options.csrfToken } : {}) },
    ...(options.body === undefined ? {} : { body: multipart ? options.body as FormData : JSON.stringify(options.body) }), signal: options.signal ?? AbortSignal.timeout(10_000) });
  if (response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body) throw new AccountApiError("unavailable", response.status);
  const reader = response.body.getReader(), buffer = new Uint8Array(65_536); let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      if (size + value.byteLength > buffer.length) throw new AccountApiError("unavailable", response.status);
      buffer.set(value, size); size += value.byteLength;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  let data: T & { error?: string; code?: string; availability?: string };
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))); }
  catch { throw new AccountApiError("unavailable", response.status); }
  if (!response.ok) throw new AccountApiError(typeof data?.code === "string" ? data.code : typeof data?.error === "string" ? data.error : "unavailable", response.status, data?.availability);
  return data;
}

export function accountErrorMessage(error: unknown) {
  if (error instanceof AccountApiError) {
    if (error.status === 429) return "Too many requests. Wait a moment and try again.";
    if (error.status === 401) return "Your session ended. Connect and sign in again.";
    if (error.status === 409 && error.code === "profile_link_conflict") return "This wallet's profile needs authenticated account recovery. Your existing data has been preserved; changing the username will not resolve the ownership conflict.";
    if (error.status === 409 && error.code === "username_taken") return "That username is unavailable. Choose another one.";
    if (error.status === 413) return "That image is too large. Choose a smaller JPG, PNG or WebP.";
    if (error.status === 403) return "This request could not be authorized. Refresh and sign in again.";
    if (error.status === 422 || error.status === 400) return "Check your profile fields and try again.";
    if (error.status === 503) return "Account services are unavailable in this preview. Your wallet and draft remain on your device.";
  }
  return "The account service could not be reached. Your changes have not been saved. Try again.";
}
