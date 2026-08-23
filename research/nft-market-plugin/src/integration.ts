export const RMT_NFT_RESEARCH_BASE = "cb4ab9b1af7200aa941bc7534795e3d43ac8dda4" as const;

export const CURRENT_CODEX_RED_ZONES = Object.freeze([
  "AGENTS.md",
  "docs/ARCHITECTURE_FREEZE.md",
  "docs/ACTIVE_SYSTEM_MAP.md",
  "docs/RMT_EXECUTION_REVENUE.md",
  "docs/TERMINAL_COMPLETION_GATE.md",
  "apps/web/package.json",
  "apps/web/app/api/vnext/authorize/route.ts",
  "apps/web/app/vnext/trade-intent-composer.tsx",
  "apps/web/app/vnext/vnext-wallet-review.tsx",
  "apps/web/lib/server/vnext-provider-adapter.ts",
  "apps/web/lib/server/vnext-sushi-adapter.ts",
  "apps/web/lib/server/vnext-sushi-execution.ts",
  "apps/web/lib/vnext/authorization-plan.ts",
  "apps/web/lib/vnext/execution-authority.ts",
  "apps/web/lib/vnext/execution-fee-policy-v2.ts",
  "apps/web/lib/vnext/provider-fee-settlement.ts",
  "apps/web/lib/vnext/pre-sign-evidence.ts",
  "apps/web/lib/vnext/quote-observation.ts",
  "apps/web/lib/vnext/wallet-submission.ts"
] as const);

export type NftAdmissionStage =
  | "research"
  | "shadow_indexer"
  | "read_only_terminal"
  | "quote_observation"
  | "strict_verification"
  | "fee_settlement_verification"
  | "authorization"
  | "wallet_submission"
  | "execution";

export type AdmissionGate = {
  stage: NftAdmissionStage;
  current: "complete" | "designed" | "blocked";
  prerequisites: string[];
  mayMutateProduction: boolean;
};

export const NFT_ADMISSION_PLAN: readonly AdmissionGate[] = Object.freeze([
  {
    stage: "research",
    current: "complete",
    prerequisites: ["standalone domain", "source registry", "security model", "wire map", "25-bps NFT fee semantics", "smoke tests"],
    mayMutateProduction: false
  },
  {
    stage: "shadow_indexer",
    current: "designed",
    prerequisites: ["explicit architecture admission", "dedicated PostgreSQL database", "dual-RPC backfill", "reorg rehearsal", "source manifest"],
    mayMutateProduction: false
  },
  {
    stage: "read_only_terminal",
    current: "blocked",
    prerequisites: ["terminal completion review", "shadow coverage evidence", "single VNext shell integration", "stale/partial/unavailable UI states"],
    mayMutateProduction: false
  },
  {
    stage: "quote_observation",
    current: "blocked",
    prerequisites: ["OpenSea API key server boundary", "order normalization", "fees/royalties provenance", "stale order invalidation"],
    mayMutateProduction: false
  },
  {
    stage: "strict_verification",
    current: "blocked",
    prerequisites: ["Seaport verifier", "criteria proof validation", "conduit resolution", "exact consideration accounting", "fresh simulation"],
    mayMutateProduction: false
  },
  {
    stage: "fee_settlement_verification",
    current: "designed",
    prerequisites: ["current RMT_EXECUTION_V2 reconciled", "versioned NFT fee policy hash", "pinned NFT executor", "Seaport buy executor proof", "seller counter-order proof", "atomic receipt reconciliation"],
    mayMutateProduction: false
  },
  {
    stage: "authorization",
    current: "blocked",
    prerequisites: ["current fungible VNext authorization work stabilized", "NFT-specific intent model", "exact NFT approval policy", "recipient binding", "verified atomic fee settlement proof"],
    mayMutateProduction: false
  },
  {
    stage: "wallet_submission",
    current: "blocked",
    prerequisites: ["controlled mainnet proof", "receipt reconciliation", "uncertain-transaction recovery", "no direct-provider fee bypass"],
    mayMutateProduction: false
  },
  {
    stage: "execution",
    current: "blocked",
    prerequisites: ["owner release decision", "provider-specific admission", "exact NFT fee policy activation", "runtime bytecode pinning", "monitoring", "rollback/disable gate"],
    mayMutateProduction: true
  }
]);

export type FutureVNextNftBridge = {
  assetClass: "nft";
  identityKey: "eip155:4663/contract:tokenId";
  directory: "Active | Trending | New | All";
  workspace: "single VNext selected-asset workspace";
  portfolio: "wallet-bound ERC-721/ERC-1155 balances";
  quoteModel: "best ask | best executable bid | sweep | exact item";
  executionBoundary: "provider-specific strict verification plus atomic fee proof before authorization";
};

export const FUTURE_VNEXT_BRIDGE: FutureVNextNftBridge = Object.freeze({
  assetClass: "nft",
  identityKey: "eip155:4663/contract:tokenId",
  directory: "Active | Trending | New | All",
  workspace: "single VNext selected-asset workspace",
  portfolio: "wallet-bound ERC-721/ERC-1155 balances",
  quoteModel: "best ask | best executable bid | sweep | exact item",
  executionBoundary: "provider-specific strict verification plus atomic fee proof before authorization"
});

export function pathIsRedZone(path: string) {
  return CURRENT_CODEX_RED_ZONES.includes(path as (typeof CURRENT_CODEX_RED_ZONES)[number]);
}
