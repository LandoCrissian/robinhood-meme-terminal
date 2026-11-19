/** Browser-test instrumentation only. Observe the actual fetch response through
 * a bounded clone, without changing its identity, body, status or request. This
 * avoids Chromium CDP discarding Network.getResponseBody for a completed read. */
export function installProfileResponseObserver({ origin, binding, maximumBytes = 65536 }) {
  const original = window.fetch;
  const watched = new Set(["PATCH /api/account/profile", "POST /api/account/avatar", "DELETE /api/account/avatar"]);
  window.fetch = async function (...args) {
    const response = await original.apply(this, args);
    const [input, init] = args, url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin !== origin || !watched.has(method + " " + url.pathname)) return response;
    const observation = { method, url: url.href, status: response.status, bodyCaptured: false };
    const copy = response.clone();
    void (async () => {
      try {
        if (!copy.body) throw Error("Mutation response has no body");
        const reader = copy.body.getReader(), chunks = []; let total = 0;
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          total += value.byteLength;
          if (total > maximumBytes) { void reader.cancel(); throw Error("Mutation response exceeds its test observation bound"); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(total); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        observation.body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        observation.bodyCaptured = true;
      } catch (error) { observation.bodyError = String(error?.message ?? error).slice(0, 1000); }
      await window[binding](observation);
    })().catch(() => { /* The test's bounded observer wait fails if delivery fails. */ });
    return response;
  };
}
