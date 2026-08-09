const RMT_APP_URL = "https://www.rmtlaunch.fun";

export function isMobileWebUserAgent(userAgent: string) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function metaMaskDappLink(rawUrl: string) {
  const destination = new URL(rawUrl, RMT_APP_URL);
  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    throw new Error("MetaMask dapp links require an HTTP(S) destination.");
  }
  const dappUrl = `${destination.host}${destination.pathname}${destination.search}${destination.hash}`;
  return `https://link.metamask.io/dapp/${dappUrl}`;
}
