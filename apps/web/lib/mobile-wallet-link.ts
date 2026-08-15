const RMT_APP_URL = "https://www.rmtlaunch.fun";

export type WalletBrowserEnvironment = "desktop" | "mobile-browser" | "mobile-wallet-browser";

export function isMobileWebUserAgent(userAgent: string) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function walletBrowserEnvironment(userAgent: string, hasInjectedEthereum: boolean): WalletBrowserEnvironment {
  if (!isMobileWebUserAgent(userAgent)) return "desktop";
  return hasInjectedEthereum ? "mobile-wallet-browser" : "mobile-browser";
}

export function metaMaskDappLink(rawUrl: string) {
  const destination = new URL(rawUrl, RMT_APP_URL);
  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    throw new Error("MetaMask dapp links require an HTTP(S) destination.");
  }
  const dappUrl = `${destination.host}${destination.pathname}${destination.search}${destination.hash}`;
  return `https://link.metamask.io/dapp/${dappUrl}`;
}

export function rabbyDappLink(rawUrl: string) {
  const destination = new URL(rawUrl, RMT_APP_URL);
  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    throw new Error("Rabby dapp links require an HTTP(S) destination.");
  }
  const link = new URL("https://go.rabby.io/mobile/");
  link.searchParams.set("_cmd", "open-dapp");
  // Rabby Mobile decodes this query value once more after URLSearchParams parsing.
  link.searchParams.set("dapp", encodeURIComponent(destination.href));
  return link.href;
}
