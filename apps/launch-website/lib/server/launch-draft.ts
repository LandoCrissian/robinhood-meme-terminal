import { emptyLaunchDraft, isLaunchReviewRequest, reviewableFields, validateLaunchDraft } from "../launch-draft";

const maxDraftRequestBytes = 4096;
const requestTimeoutMs = 3000;
const headers = {
  "Cache-Control": "private, no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function failure(status: number, error: string) {
  return Response.json({ status: "error", error }, { status, headers });
}

function sameOrigin(request: Request, url: URL) {
  // Next's production-style local server can use localhost in Request.url.
  // Host is the browser's authority. Ignore forwarded host/proto headers.
  const host = (request.headers.get("host") ?? url.host).toLowerCase();
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) return false;
  const loopback = /^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/.test(host)
    && ["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:";
  try {
    const expected = new URL(`${loopback ? "http" : "https"}://${host}`).origin;
    return request.headers.get("origin") === expected;
  } catch {
    return false;
  }
}

export async function readDraftBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const buffer = new Uint8Array(maxDraftRequestBytes);
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Draft read timed out")), requestTimeoutMs);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (bytes + value.byteLength > maxDraftRequestBytes) return { tooLarge: true } as const;
      buffer.set(value, bytes);
      bytes += value.byteLength;
    }
    const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)));
    return { input };
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Returns a draft preview only. This handler never writes, signs, or reads chain state. */
export async function reviewLaunchDraft(request: Request) {
  if (request.method !== "POST") return failure(405, "Use POST to validate a draft.");
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return failure(403, "Review from this website to validate a draft.");
  if (url.search) return failure(400, "Draft review does not accept query parameters.");
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return failure(415, "Send the draft as JSON.");
  }
  const declaredBytes = request.headers.get("content-length");
  if (declaredBytes !== null && (!/^\d+$/.test(declaredBytes) || Number(declaredBytes) > maxDraftRequestBytes)) {
    return failure(413, "Draft exceeds the request size limit.");
  }
  if (!request.body) return failure(400, "Enter the draft fields and try again.");

  try {
    const body = await readDraftBody(request.body);
    if (body.tooLarge) return failure(413, "Draft exceeds the request size limit.");
    if (!isLaunchReviewRequest(body.input)) return failure(400, "Enter the draft fields and try again.");
    const result = validateLaunchDraft({ ...emptyLaunchDraft, ...body.input });
    return result.ok
      ? Response.json({ status: "reviewed", draft: reviewableFields(result.draft) }, { headers })
      : Response.json({ status: "invalid", errors: result.errors }, { status: 422, headers });
  } catch {
    return failure(400, "The draft could not be read. Try again.");
  }
}
