const URL = /https?:\/\/[^\s"'<>]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi;
const SECRET_ASSIGNMENT = /\b(authorization|api[-_ ]?key|access[-_ ]?token|id[-_ ]?token|secret|password)\b(\s*[:=]\s*)([^\s,;}"]+)/gi;
const LONG_CALLDATA = /0x[0-9a-fA-F]{128,}/g;

/**
 * Remove provider URLs, bearer credentials, JWTs, secret assignments, and
 * long calldata before an RPC or wallet error is shown or copied. Transaction
 * hashes and public contract addresses remain available through structured
 * execution fields and Blockscout links.
 */
export function sanitizeTradeDiagnosticText(value: unknown, maximumLength = 500) {
  const source = typeof value === "string"
    ? value
    : value instanceof Error
      ? value.message
      : String(value ?? "");
  return source
    .replace(URL, "[redacted-url]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[redacted-token]")
    .replace(SECRET_ASSIGNMENT, (_match, key: string, separator: string) => `${key}${separator}[redacted]`)
    .replace(LONG_CALLDATA, "[redacted-calldata]")
    .slice(0, Math.max(0, Math.min(maximumLength, 2_000)));
}
