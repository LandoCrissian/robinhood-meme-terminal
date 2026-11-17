export default function launchCreationLimit(): undefined {
  // The server still validates release acceptance, origin and the exact owner.
  return undefined;
}

// Personal allows two code-based rules per project: this is the second rule.
// https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
// Per-IP/domain enforcement can lag by up to 10 seconds, is not a global cap,
// and must be confirmed in future deploy post-processing logs before activation.
export const config = {
  path: "/api/launchpad/production-creation",
  rateLimit: { windowSize: 60, windowLimit: 12, aggregateBy: ["ip", "domain"] },
};
