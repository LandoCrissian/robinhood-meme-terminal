import {
  readVNextCanonicalMarketDirectoryPage,
  type VNextCanonicalMarketDirectoryPage
} from "./vnext-canonical-market-directory";
import {
  readVNextLegacyMarketDirectoryPage,
  type VNextLegacyMarketDirectoryPage
} from "./vnext-legacy-market-directory";
import {
  applyProjectIdentityDirectoryAdmission,
  type ProjectIdentityAdmissionCandidate
} from "./project-identity-admission";

type CanonicalReader = (requestUrl: string) => Promise<VNextCanonicalMarketDirectoryPage>;
type LegacyReader = () => Promise<VNextLegacyMarketDirectoryPage>;
type ProjectAdmissionFilter = <T extends ProjectIdentityAdmissionCandidate>(candidates: readonly T[]) => Promise<T[]>;

type VNextMarketDirectoryRouteDependencies = {
  readCanonical: CanonicalReader;
  readLegacy: LegacyReader;
  admitProjectIdentities?: ProjectAdmissionFilter;
};

export type VNextMarketDirectoryRouteResult = {
  status: 200 | 400 | 503;
  body: VNextCanonicalMarketDirectoryPage["body"] | VNextLegacyMarketDirectoryPage["body"];
  headers: Readonly<Record<string, string>>;
};

const defaultDependencies: VNextMarketDirectoryRouteDependencies = {
  readCanonical: readVNextCanonicalMarketDirectoryPage,
  readLegacy: readVNextLegacyMarketDirectoryPage,
  admitProjectIdentities: async <T extends ProjectIdentityAdmissionCandidate>(candidates: readonly T[]) => (
    await applyProjectIdentityDirectoryAdmission(candidates)
  ).admitted
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
  const body = result.status === 200
    ? {
        ...result.body,
        markets: await (dependencies.admitProjectIdentities ?? defaultDependencies.admitProjectIdentities!)(result.body.markets ?? [])
      }
    : result.body;
  return {
    ...result,
    body,
    headers: { "Cache-Control": "private, no-store, max-age=0" }
  };
}
