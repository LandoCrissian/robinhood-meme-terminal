import {
  readVNextCanonicalMarketDirectoryPage,
  type VNextCanonicalMarketDirectoryPage
} from "./vnext-canonical-market-directory";
import {
  readVNextLegacyMarketDirectoryPage,
  type VNextLegacyMarketDirectoryPage
} from "./vnext-legacy-market-directory";

type CanonicalReader = (requestUrl: string) => Promise<VNextCanonicalMarketDirectoryPage>;
type LegacyReader = () => Promise<VNextLegacyMarketDirectoryPage>;

type VNextMarketDirectoryRouteDependencies = {
  readCanonical: CanonicalReader;
  readLegacy: LegacyReader;
};

export type VNextMarketDirectoryRouteResult = {
  status: 200 | 400 | 503;
  body: VNextCanonicalMarketDirectoryPage["body"] | VNextLegacyMarketDirectoryPage["body"];
  headers: Readonly<Record<string, string>>;
};

const defaultDependencies: VNextMarketDirectoryRouteDependencies = {
  readCanonical: readVNextCanonicalMarketDirectoryPage,
  readLegacy: readVNextLegacyMarketDirectoryPage
};

export function vNextCanonicalBrowseEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  return env.RMT_CANONICAL_BROWSE_ENABLED === "true";
}

export async function readVNextMarketDirectoryRequest(
  requestUrl: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: VNextMarketDirectoryRouteDependencies = defaultDependencies
): Promise<VNextMarketDirectoryRouteResult> {
  if (!vNextCanonicalBrowseEnabled(env)) return dependencies.readLegacy();
  const result = await dependencies.readCanonical(requestUrl);
  return {
    ...result,
    headers: { "Cache-Control": "private, no-store, max-age=0" }
  };
}
