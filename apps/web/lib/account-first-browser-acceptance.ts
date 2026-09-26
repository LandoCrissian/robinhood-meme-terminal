export const accountFirstBrowserAcceptanceBuild =
  process.env.NEXT_PUBLIC_RMT_ACCOUNT_ACCEPTANCE_PROFILE === "true";

export function isLoopbackAcceptanceHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function accountFirstBrowserAcceptanceEnabled() {
  return accountFirstBrowserAcceptanceBuild
    && typeof window !== "undefined"
    && isLoopbackAcceptanceHostname(window.location.hostname);
}
