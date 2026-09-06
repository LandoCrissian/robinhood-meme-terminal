// Test process preload. No application modules or API responses are replaced.
const originalFetch = globalThis.fetch;
// Do not let prior developer/build HTTP cache entries bypass network fixtures.
const fs = require('node:fs');
const originalReadFile = fs.promises.readFile;
fs.promises.readFile = async function (file, ...args) {
  if (String(file).replaceAll('\\', '/').includes('/cache/fetch-cache/')) {
    const error = new Error('Isolated acceptance HTTP cache'); error.code = 'ENOENT'; throw error;
  }
  return originalReadFile.call(this, file, ...args);
};
const boundary = process.env.RMT_ACCEPTANCE_BOUNDARY_URL;
if (!boundary || new URL(boundary).hostname !== '127.0.0.1') {
  throw new Error('0x browser acceptance requires a loopback boundary server.');
}
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return originalFetch(input, init);
  const request = new Request(input, init);
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text();
  return originalFetch(`${boundary}/external`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: url.href, method: request.method, body,
      version: request.headers.get('0x-version'),
      credentialIsFixture: request.headers.get('0x-api-key') === 'server-only-test-key' }),
    signal: request.signal
  });
};
