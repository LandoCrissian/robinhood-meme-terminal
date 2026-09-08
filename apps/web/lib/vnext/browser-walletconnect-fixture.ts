import { injected } from "wagmi/connectors";

/** Test boundary only: production builds/hosts cannot install this transport fixture. */
export function browserWalletConnectFixture() {
  if (process.env.NEXT_PUBLIC_RMT_BROWSER_ACCEPTANCE_PROFILE !== "true" || typeof window === "undefined"
    || !["localhost", "127.0.0.1"].includes(window.location.hostname)) return [];
  const provider = (window as unknown as { __RMT_ACCEPTANCE_WALLETCONNECT_PROVIDER__?: unknown }).__RMT_ACCEPTANCE_WALLETCONNECT_PROVIDER__;
  if (!provider) return [];
  const factory = injected({ target: { id: "rmt-walletconnect-fixture", name: "Deterministic mobile wallet", provider: () => provider as never } });
  return [(config: Parameters<typeof factory>[0]) => ({ ...factory(config),
    id: "rmt-walletconnect-fixture", name: "Deterministic mobile wallet", type: "walletConnect" })];
}
