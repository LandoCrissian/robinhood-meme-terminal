const MAX_RATE_LIMIT_BUCKETS = 2_000;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

// Defense in depth only: serverless instances do not share this state. A durable
// edge rate limiter is still needed if sustained abuse becomes a production issue.
const rateLimitBuckets = new Map<string, RateLimitBucket>();

export type MediaRequestFailure = {
  ok: false;
  status: 400 | 403 | 413 | 415 | 429;
  error: string;
  retryAfterSeconds?: number;
};

export type MediaRequestSuccess<T> = {
  ok: true;
  value: T;
};

function serializedOrigin(value: string | null) {
  if (!value || value === "null") return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return value === url.origin ? url.origin : null;
  } catch {
    return null;
  }
}

export function isSameOriginMediaRequest(request: Request) {
  // Origin checks stop cross-site browser use, but they are not authentication:
  // a non-browser client can forge these headers and is additionally quota-bound.
  const requestOrigin = serializedOrigin(new URL(request.url).origin);
  const callerOrigin = serializedOrigin(request.headers.get("origin"));
  if (!requestOrigin || !callerOrigin || callerOrigin !== requestOrigin) return false;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  return !fetchSite || fetchSite === "same-origin";
}

export function mediaClientAddress(request: Request) {
  const candidates = [
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0],
    request.headers.get("x-forwarded-for")?.split(",")[0],
    request.headers.get("x-real-ip")
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.length <= 64 && /^[0-9a-f:.]+$/i.test(value)) return value;
  }

  return "unknown";
}

function pruneExpiredBuckets(now: number) {
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

export function guardMediaRequest(
  request: Request,
  options: { namespace: string; limit: number; windowMs: number; now?: number }
): { ok: true; remaining: number } | MediaRequestFailure {
  if (!isSameOriginMediaRequest(request)) {
    return { ok: false, status: 403, error: "This request must come from RMT." };
  }

  const now = options.now ?? Date.now();
  const key = `${options.namespace}:${mediaClientAddress(request)}`;
  let bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) pruneExpiredBuckets(now);
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS && !rateLimitBuckets.has(key)) {
      return {
        ok: false,
        status: 429,
        error: "Media uploads are busy. Please wait and try again.",
        retryAfterSeconds: Math.max(1, Math.ceil(options.windowMs / 1_000))
      };
    }

    bucket = { count: 0, resetAt: now + options.windowMs };
    rateLimitBuckets.set(key, bucket);
  }

  if (bucket.count >= options.limit) {
    return {
      ok: false,
      status: 429,
      error: "Too many media requests. Please wait and try again.",
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
    };
  }

  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, options.limit - bucket.count) };
}

async function readBoundedText(stream: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!stream) return { ok: true as const, value: "" };

  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let value = "";

  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byteCount += part.value.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false as const, tooLarge: true as const };
      }
      value += decoder.decode(part.value, { stream: true });
    }
    value += decoder.decode();
    return { ok: true as const, value };
  } catch {
    return { ok: false as const, tooLarge: false as const };
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJsonRequest(
  request: Request,
  maxBytes: number
): Promise<MediaRequestSuccess<unknown> | MediaRequestFailure> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, status: 415, error: "The request must use JSON." };
  }

  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    return { ok: false, status: 415, error: "Encoded request bodies are not supported." };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      return { ok: false, status: 400, error: "The request size is invalid." };
    }
    if (Number(contentLength) > maxBytes) {
      return { ok: false, status: 413, error: "The request is too large." };
    }
  }

  const body = await readBoundedText(request.body, maxBytes);
  if (!body.ok) {
    return body.tooLarge
      ? { ok: false, status: 413, error: "The request is too large." }
      : { ok: false, status: 400, error: "The request body is invalid." };
  }

  try {
    return { ok: true, value: JSON.parse(body.value) as unknown };
  } catch {
    return { ok: false, status: 400, error: "The request body is invalid." };
  }
}

export async function readBoundedFormRequest(
  request: Request,
  maxBytes: number
): Promise<MediaRequestSuccess<URLSearchParams> | MediaRequestFailure> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return { ok: false, status: 415, error: "The request must use form encoding." };
  }

  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    return { ok: false, status: 415, error: "Encoded request bodies are not supported." };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      return { ok: false, status: 400, error: "The request size is invalid." };
    }
    if (Number(contentLength) > maxBytes) {
      return { ok: false, status: 413, error: "The request is too large." };
    }
  }

  const body = await readBoundedText(request.body, maxBytes);
  if (!body.ok) {
    return body.tooLarge
      ? { ok: false, status: 413, error: "The request is too large." }
      : { ok: false, status: 400, error: "The request body is invalid." };
  }

  if (/\0|[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body.value)) {
    return { ok: false, status: 400, error: "The request body is invalid." };
  }
  return { ok: true, value: new URLSearchParams(body.value) };
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  request: typeof fetch = fetch
): Promise<{ ok: true; response: Response } | { ok: false; timedOut: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return { ok: true, response: await request(input, { ...init, signal: controller.signal }) };
  } catch {
    return { ok: false, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timeout);
  }
}

export async function readBoundedJsonResponse(response: Response, maxBytes: number) {
  const body = await readBoundedText(response.body, maxBytes);
  if (!body.ok) return null;

  try {
    return JSON.parse(body.value) as unknown;
  } catch {
    return null;
  }
}
