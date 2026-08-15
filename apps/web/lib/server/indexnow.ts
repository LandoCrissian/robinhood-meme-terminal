import { RMT_SITE_URL } from "../site-identity";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const RMT_INDEXNOW_KEY = "rmt-indexnow-public-proof-2026";
export const RMT_INDEXNOW_KEY_PATH = `/${RMT_INDEXNOW_KEY}.txt`;
export const INDEXNOW_MAX_URLS = 10_000;

const siteUrl = new URL(RMT_SITE_URL);
const blockedPrefixes = [
  "/api/",
  "/admin",
  "/profile",
  "/portfolio",
  "/watchlist",
  "/deploy-",
  "/activate-",
  "/mainnet-smoke",
  "/vnext"
] as const;

export function canonicalIndexNowUrl(value: string) {
  try {
    const url = new URL(value, `${RMT_SITE_URL}/`);
    if (
      url.origin !== siteUrl.origin
      || url.protocol !== "https:"
      || url.username
      || url.password
      || blockedPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function buildIndexNowPayload(values: readonly string[]) {
  const urlList = [...new Set(values.flatMap((value) => {
    const canonical = canonicalIndexNowUrl(value);
    return canonical ? [canonical] : [];
  }))];

  if (urlList.length === 0) {
    throw new Error("IndexNow requires at least one canonical public RMT URL.");
  }
  if (urlList.length > INDEXNOW_MAX_URLS) {
    throw new Error(`IndexNow accepts at most ${INDEXNOW_MAX_URLS} URLs per request.`);
  }

  return {
    host: siteUrl.host,
    key: RMT_INDEXNOW_KEY,
    keyLocation: `${RMT_SITE_URL}${RMT_INDEXNOW_KEY_PATH}`,
    urlList
  } as const;
}

export async function submitIndexNowUrls(
  values: readonly string[],
  request: typeof fetch = fetch
) {
  const payload = buildIndexNowPayload(values);
  const response = await request(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  if (response.status !== 200 && response.status !== 202) {
    const detail = (await response.text()).trim().slice(0, 300);
    throw new Error(
      `IndexNow rejected ${payload.urlList.length} RMT URLs with HTTP ${response.status}`
      + (detail ? `: ${detail}` : ".")
    );
  }

  return { status: response.status, submitted: payload.urlList.length } as const;
}
