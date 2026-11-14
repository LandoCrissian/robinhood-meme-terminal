export default function launchDiscoveryLimit(): undefined {
  // Returning no response continues through the application's read-only middleware.
  return undefined;
}

export const config = {
  pattern: "^(?:/|/(?:rmt|api/launchpad/launches(?:/0[xX][0-9A-Fa-f]{40})?|launches/0[xX][0-9A-Fa-f]{40})/?)$",
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: ["ip", "domain"] },
};
