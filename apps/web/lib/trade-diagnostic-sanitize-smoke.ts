import assert from "node:assert/strict";
import { sanitizeTradeDiagnosticText } from "./trade-diagnostic-sanitize";

const sanitized = sanitizeTradeDiagnosticText(
  "RPC https://provider.example/v2/private-key?apiKey=secret "
  + "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 "
  + "id_token=eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop "
  + `calldata=0x${"ab".repeat(96)}`
);

assert.doesNotMatch(sanitized, /private-key|apiKey=secret|abcdefghijklmnopqrstuvwxyz123456|eyJabcdefghijk/);
assert.match(sanitized, /\[redacted-url\]/);
assert.match(sanitized, /Bearer \[redacted\]/);
assert.match(sanitized, /id_token=\[redacted\]/);
assert.match(sanitized, /\[redacted-calldata\]/);
assert.equal(sanitizeTradeDiagnosticText("visible error", 7), "visible ");

console.info("Trade diagnostic redaction smoke test passed");
