import assert from "node:assert/strict";

export function observeLifecycleRsc(page, {origin, token, now = () => new Date().toISOString()}) {
  const entries = [], byRequest = new Map();
  const isExpected = request => {
    try {
      const url = new URL(request.url()), current = token();
      return request.method() === "GET" && typeof current === "string"
        && url.origin === origin && url.pathname.toLowerCase() === ("/launches/" + current).toLowerCase()
        && url.searchParams.has("_rsc");
    } catch { return false; }
  };
  page.on("request", request => {
    if (!isExpected(request)) return;
    // Inspect only the public framework classification; never archive headers.
    const prefetch = request.headers?.()?.["next-router-prefetch"] === "1";
    const row = {sequence: entries.length, path: new URL(request.url()).pathname,
      rsc: true, prefetch, startedAt: now(), status: "pending"};
    entries.push(row); byRequest.set(request, row);
  });
  page.on("response", response => {
    const row = byRequest.get(response.request());
    if (row) row.httpStatus = response.status();
  });
  // requestfinished is emitted after the response body is downloaded, not
  // merely when response headers arrive. A failed stream never completes.
  page.on("requestfinished", request => {
    const row = byRequest.get(request);
    if (row && row.status === "pending") {row.status = "body-complete"; row.finishedAt = now();}
  });
  page.on("requestfailed", request => {
    const row = byRequest.get(request);
    if (row && row.status === "pending") {
      row.status = "failed"; row.finishedAt = now();
      row.failure = (request.failure()?.errorText ?? "unknown").slice(0, 256);
    }
  });
  const snapshot = () => entries.map(row => ({...row}));
  async function waitPending(waitFor) {
    // Snapshot only currently pending reads for the token about to be left.
    // A completed or historically canceled request is diagnostic, not a new
    // transaction prerequisite. Empty snapshots return immediately.
    const currentPath = typeof token() === "string" ? ("/launches/" + token()).toLowerCase() : undefined;
    const pending = entries.filter(row => row.status === "pending" && !row.prefetch
      && row.path.toLowerCase() === currentPath);
    assert.equal(typeof waitFor, "function");
    // This is an action-quiescence barrier, not a freshness or HTTP-success
    // assertion. Either terminal event means navigation cannot interrupt that
    // captured stream. Preserve the actual failure/status for diagnostics.
    await waitFor("known same-token RSC requests to terminate before navigation",
      async () => pending.every(row => row.status !== "pending"));
    return pending.map(row => ({...row}));
  }
  return {snapshot, waitPending};
}
