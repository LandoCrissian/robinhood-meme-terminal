export default function launchDiscoveryLimit(): undefined {
  // Returning no response continues through the application's read-only middleware.
  return undefined;
}

export const config = {
  // One function-level traffic rule covers these read routes. The application's
  // middleware and handlers independently validate address and username shapes.
  path: ["/", "/api/launchpad/creation-review", "/api/launchpad/launches", "/api/launchpad/launches/:token",
    "/api/launchpad/new-engine", "/api/launchpad/new-engine/:token", "/launches/:token",
    "/u/:username", "/creator/:wallet", "/api/account/public/:username", "/api/account/creator/:wallet",
    "/api/account/avatar/:wallet", "/api/account/session"],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: ["ip", "domain"] },
};
