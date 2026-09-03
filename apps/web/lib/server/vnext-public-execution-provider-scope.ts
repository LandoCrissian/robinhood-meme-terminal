import type { VNextQuoteProvider } from "../vnext/quote-observation";
import {
  VNEXT_V2_ATOMIC_INPUT_FEE,
  type VNextExecutionSettlementMode
} from "../vnext/execution-settlement";

export const VNEXT_PUBLIC_EXECUTION_PROVIDER_IDS = Object.freeze([
  "sushi",
  "uniswap-v2",
  "uniswap-v3",
  "uniswap-v4",
  "uniswapx",
  "zero-x-swap",
  "zero-x-gasless",
  "up-v2",
  "up-cl"
] as const satisfies readonly VNextQuoteProvider[]);

const KNOWN_PROVIDERS = new Set<VNextQuoteProvider>(VNEXT_PUBLIC_EXECUTION_PROVIDER_IDS);

export type VNextPublicExecutionProviderEnvironment = Readonly<{
  RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS?: string;
}>;

export type VNextPublicExecutionProviderScope = Readonly<{
  configured: boolean;
  valid: boolean;
  providers: readonly VNextQuoteProvider[];
}>;

export type VNextPublicExecutionReleaseScope = "v3-only" | "v2-v3" | "invalid-unreleased";

export const VNEXT_PUBLIC_EXECUTION_RELEASE_SCOPE_V3_ONLY = "uniswap-v3" as const;
export const VNEXT_PUBLIC_EXECUTION_RELEASE_SCOPE_V2_V3 = "uniswap-v2,uniswap-v3" as const;

export class VNextPublicExecutionProviderConfigurationError extends Error {
  constructor() {
    super("RMT public execution provider scope is malformed.");
    this.name = "VNextPublicExecutionProviderConfigurationError";
  }
}

export class VNextPublicExecutionProviderNotReleasedError extends Error {
  constructor(provider: VNextQuoteProvider) {
    super(`${provider} is not admitted to public wallet execution.`);
    this.name = "VNextPublicExecutionProviderNotReleasedError";
  }
}

export class VNextPublicExecutionSettlementNotReleasedError extends Error {
  constructor(provider: VNextQuoteProvider) {
    super(`${provider} does not have the settlement authority required for public wallet execution.`);
    this.name = "VNextPublicExecutionSettlementNotReleasedError";
  }
}

export function readVNextPublicExecutionProviderScope(
  env: VNextPublicExecutionProviderEnvironment = process.env as unknown as VNextPublicExecutionProviderEnvironment
): VNextPublicExecutionProviderScope {
  const configuredValue = env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS;
  if (configuredValue === undefined) {
    return Object.freeze({ configured: false, valid: true, providers: Object.freeze([]) });
  }

  const members = configuredValue.split(",").map((member) => member.trim());
  if (members.length === 0 || members.some((member) => member.length === 0)) {
    return Object.freeze({ configured: true, valid: false, providers: Object.freeze([]) });
  }

  const providers: VNextQuoteProvider[] = [];
  const seen = new Set<VNextQuoteProvider>();
  for (const member of members) {
    if (!KNOWN_PROVIDERS.has(member as VNextQuoteProvider) || seen.has(member as VNextQuoteProvider)) {
      return Object.freeze({ configured: true, valid: false, providers: Object.freeze([]) });
    }
    const provider = member as VNextQuoteProvider;
    seen.add(provider);
    providers.push(provider);
  }

  return Object.freeze({ configured: true, valid: true, providers: Object.freeze(providers) });
}

export function isVNextPublicExecutionProviderReleased(
  provider: VNextQuoteProvider,
  env: VNextPublicExecutionProviderEnvironment = process.env as unknown as VNextPublicExecutionProviderEnvironment
) {
  const scope = readVNextPublicExecutionProviderScope(env);
  return scope.valid && scope.providers.includes(provider);
}

export function requireVNextPublicExecutionProvider(
  provider: VNextQuoteProvider,
  env: VNextPublicExecutionProviderEnvironment = process.env as unknown as VNextPublicExecutionProviderEnvironment
) {
  const scope = readVNextPublicExecutionProviderScope(env);
  if (!scope.valid) throw new VNextPublicExecutionProviderConfigurationError();
  if (!scope.providers.includes(provider)) throw new VNextPublicExecutionProviderNotReleasedError(provider);
}

export function requireVNextPublicExecutionSettlement(
  provider: VNextQuoteProvider,
  settlementMode: VNextExecutionSettlementMode,
  env: VNextPublicExecutionProviderEnvironment = process.env as unknown as VNextPublicExecutionProviderEnvironment
) {
  requireVNextPublicExecutionProvider(provider, env);
  if ((provider === "uniswap-v2" || provider === "uniswap-v3") && settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE) {
    throw new VNextPublicExecutionSettlementNotReleasedError(provider);
  }
}

export function vNextPublicExecutionProviderScopeErrorResponse(cause: unknown) {
  if (cause instanceof VNextPublicExecutionProviderConfigurationError) {
    return Response.json(
      { error: "Public wallet execution is unavailable because its provider release scope is invalid." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (cause instanceof VNextPublicExecutionProviderNotReleasedError) {
    return Response.json(
      { error: cause.message, code: "PROVIDER_QUOTE_ONLY" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (cause instanceof VNextPublicExecutionSettlementNotReleasedError) {
    return Response.json(
      { error: cause.message, code: "PROVIDER_SETTLEMENT_QUOTE_ONLY" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  return null;
}

export function hasExactVNextV3V2PublicExecutionProviderScope(
  env: VNextPublicExecutionProviderEnvironment = process.env as unknown as VNextPublicExecutionProviderEnvironment
) {
  return readVNextPublicExecutionReleaseScope(env) === "v3-only";
}

export function hasExactVNextV2V3PublicExecutionProviderScope(
  env: VNextPublicExecutionProviderEnvironment = process.env as unknown as VNextPublicExecutionProviderEnvironment
) {
  return readVNextPublicExecutionReleaseScope(env) === "v2-v3";
}

export function readVNextPublicExecutionReleaseScope(
  env: VNextPublicExecutionProviderEnvironment = process.env as unknown as VNextPublicExecutionProviderEnvironment
): VNextPublicExecutionReleaseScope {
  const scope = readVNextPublicExecutionProviderScope(env);
  if (!scope.configured || !scope.valid) return "invalid-unreleased";
  if (env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS === VNEXT_PUBLIC_EXECUTION_RELEASE_SCOPE_V3_ONLY) return "v3-only";
  if (env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS === VNEXT_PUBLIC_EXECUTION_RELEASE_SCOPE_V2_V3) return "v2-v3";
  return "invalid-unreleased";
}
