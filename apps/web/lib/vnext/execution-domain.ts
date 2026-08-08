/**
 * Provider-neutral contracts for RMT Terminal VNext.
 *
 * This module is intentionally disconnected from production trading routes. It
 * defines the invariants that future Robinhood and multi-chain adapters must
 * satisfy before their data can reach an authorization surface.
 */

export const VNEXT_EXECUTION_SCHEMA_VERSION = 1 as const;

export type ChainFamily = "evm" | "solana";

export type ChainRef =
  | { family: "evm"; namespace: "eip155"; reference: string }
  | { family: "solana"; namespace: "solana"; reference: string };

export type AssetLocator =
  | { kind: "native" }
  | { kind: "contract"; address: string }
  | { kind: "mint"; mint: string };

export type AssetId = {
  chain: ChainRef;
  locator: AssetLocator;
};

export type AssetMetadata = {
  id: AssetId;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  metadataState: "verified" | "reported" | "unknown" | "conflicting";
};

export type WalletAccount = {
  accountId: string;
  chain: ChainRef;
  address: string;
  custody: "self_custody" | "embedded_self_custody";
};

export type AssetRouteState =
  | "detected"
  | "route_checking"
  | "tradeable"
  | "no_route_found"
  | "temporarily_unavailable"
  | "policy_restricted"
  | "unknown_review";

export type AssetBalanceSnapshot = {
  schemaVersion: typeof VNEXT_EXECUTION_SCHEMA_VERSION;
  account: WalletAccount;
  asset: AssetMetadata;
  settledAtomic: string;
  pendingIncomingAtomic: string;
  pendingOutgoingAtomic: string;
  reservedAtomic: string;
  routeState: AssetRouteState;
  observedAtMs: number;
  blockReference: string | null;
};

export type Valuation = {
  currency: "USD";
  amount: string;
  asOfMs: number;
  confidence: "firm" | "indicative" | "stale" | "unavailable";
  source: string | null;
};

export type TradeType = "exact_input" | "exact_output";
export type ExecutionPreference = "recommended" | "best_price" | "fastest" | "lowest_gas";

export type TradeIntent = {
  schemaVersion: typeof VNEXT_EXECUTION_SCHEMA_VERSION;
  intentId: string;
  sourceAccount: WalletAccount;
  inputAsset: AssetId;
  outputAsset: AssetId;
  amountAtomic: string;
  tradeType: TradeType;
  recipient: WalletAccount;
  preference: ExecutionPreference;
  requestedAtMs: number;
};

export type ExecutionCapability =
  | "direct_amm"
  | "aggregator"
  | "rfq"
  | "dutch_auction"
  | "gasless"
  | "cross_chain"
  | "limit"
  | "recurring";

export type ProviderFamily =
  | "sushi"
  | "uniswap"
  | "uniswapx"
  | "pancakeswap"
  | "pancakeswapx"
  | "zeroex"
  | "oneinch"
  | "kyberswap"
  | "future";

export type ExecutionFee = {
  kind: "provider" | "rmt" | "network" | "bridge" | "liquidity";
  asset: AssetId;
  amountAtomic: string;
  payer: "user" | "filler" | "provider" | "sponsor";
  disclosure: string;
};

export type PolicyFinding = {
  code: string;
  title: string;
  detail: string;
};

export type PolicyDecision = {
  eligibility: "permitted" | "restricted" | "unknown";
  warnings: PolicyFinding[];
  blockers: PolicyFinding[];
};

export type AuthorizationKind =
  | "evm_transaction"
  | "evm_typed_data"
  | "solana_transaction"
  | "cross_chain_bundle";

export type AuthorizationSummary = {
  kind: AuthorizationKind;
  approvalRequired: boolean;
  approvalSpender: string | null;
  permitContract: string | null;
  settlementTarget: string;
  userPaysGas: boolean;
};

export type VerificationStrategy = {
  verifierId: string;
  verifierVersion: number;
  expectedSourceChain: ChainRef;
  expectedDestinationChain: ChainRef;
  expectedTargets: string[];
  unknownFields: "reject";
};

export type ExecutionCandidate = {
  schemaVersion: typeof VNEXT_EXECUTION_SCHEMA_VERSION;
  candidateId: string;
  intentId: string;
  provider: string;
  providerFamily: ProviderFamily;
  adapterVersion: number;
  capabilities: ExecutionCapability[];
  inputAsset: AssetId;
  outputAsset: AssetId;
  recipient: WalletAccount;
  inputAmountAtomic: string;
  maximumInputAtomic: string | null;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  fees: ExecutionFee[];
  authorization: AuthorizationSummary;
  verification: VerificationStrategy;
  quotedAtMs: number;
  expiresAtMs: number;
  expectedSettlementSeconds: number | null;
  settlementMode: "synchronous_transaction" | "asynchronous_fill" | "multi_step";
  policy: PolicyDecision;
  routeDescription: string;
  providerQuoteRef: string;
};

export type AuthorizationPlan = {
  schemaVersion: typeof VNEXT_EXECUTION_SCHEMA_VERSION;
  planId: string;
  intentId: string;
  candidateId: string;
  providerFamily: ProviderFamily;
  kind: AuthorizationKind;
  payloadRef: string;
  payloadHash: string;
  verifiedAtMs: number;
  expiresAtMs: number;
  verifierId: string;
  verifierVersion: number;
};

export type SettlementRecord = {
  schemaVersion: typeof VNEXT_EXECUTION_SCHEMA_VERSION;
  settlementId: string;
  intentId: string;
  candidateId: string;
  chain: ChainRef;
  status: "submitted" | "open" | "confirmed" | "failed" | "expired" | "cancelled" | "unknown";
  transactionIds: string[];
  submittedAtMs: number;
  confirmedAtMs: number | null;
  inputAmountAtomic: string;
  outputAmountAtomic: string | null;
};

export type ExecutionSession =
  | { state: "draft"; intent: TradeIntent }
  | { state: "quoting"; intent: TradeIntent; startedAtMs: number }
  | { state: "reviewing"; intent: TradeIntent; candidates: ExecutionCandidate[]; selectedCandidateId: string }
  | { state: "verifying"; intent: TradeIntent; candidate: ExecutionCandidate }
  | { state: "ready_for_authorization"; intent: TradeIntent; candidate: ExecutionCandidate; plan: AuthorizationPlan }
  | { state: "authorizing"; intent: TradeIntent; candidate: ExecutionCandidate; plan: AuthorizationPlan }
  | { state: "pending_settlement"; intent: TradeIntent; candidate: ExecutionCandidate; settlement: SettlementRecord }
  | { state: "settled"; intent: TradeIntent; candidate: ExecutionCandidate; settlement: SettlementRecord }
  | { state: "failed"; intent: TradeIntent; failureCode: string; detail: string; retryable: boolean }
  | { state: "expired"; intent: TradeIntent; detail: string }
  | { state: "cancelled"; intent: TradeIntent; detail: string };

export type ExecutionEvent =
  | { type: "REQUEST_QUOTES"; nowMs: number }
  | { type: "QUOTES_READY"; candidates: ExecutionCandidate[]; selectedCandidateId: string }
  | { type: "VERIFY_SELECTED" }
  | { type: "VERIFICATION_PASSED"; plan: AuthorizationPlan; nowMs: number }
  | { type: "REQUEST_AUTHORIZATION"; nowMs: number }
  | { type: "SUBMITTED"; settlement: SettlementRecord }
  | { type: "SETTLEMENT_CONFIRMED"; settlement: SettlementRecord }
  | { type: "FAIL"; failureCode: string; detail: string; retryable: boolean }
  | { type: "EXPIRE"; detail: string }
  | { type: "CANCEL"; detail: string }
  | { type: "RETRY" };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid RMT VNext execution data: ${message}.`);
}

export function atomicAmount(value: unknown, options: { allowZero?: boolean } = {}) {
  invariant(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), "amount must be a canonical atomic-unit string");
  invariant(options.allowZero || BigInt(value) > 0n, "amount must be positive");
  return value;
}

export function evmChain(chainId: number): ChainRef {
  invariant(Number.isSafeInteger(chainId) && chainId > 0, "EVM chain ID must be a positive safe integer");
  return { family: "evm", namespace: "eip155", reference: String(chainId) };
}

export function solanaChain(reference = "mainnet"): ChainRef {
  const normalized = reference.trim().toLowerCase();
  invariant(/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized), "Solana chain reference is invalid");
  return { family: "solana", namespace: "solana", reference: normalized };
}

export function evmAsset(chainId: number, address: string): AssetId {
  invariant(EVM_ADDRESS.test(address), "EVM asset address is invalid");
  return { chain: evmChain(chainId), locator: { kind: "contract", address: address.toLowerCase() } };
}

export function evmNativeAsset(chainId: number): AssetId {
  return { chain: evmChain(chainId), locator: { kind: "native" } };
}

export function solanaAsset(mint: string, reference = "mainnet"): AssetId {
  invariant(SOLANA_ADDRESS.test(mint), "Solana mint is invalid");
  return { chain: solanaChain(reference), locator: { kind: "mint", mint } };
}

export function chainKey(chain: ChainRef) {
  return `${chain.namespace}:${chain.reference}`;
}

export function assetKey(asset: AssetId) {
  const prefix = chainKey(asset.chain);
  if (asset.locator.kind === "native") return `${prefix}/native`;
  if (asset.locator.kind === "contract") return `${prefix}/contract:${asset.locator.address.toLowerCase()}`;
  return `${prefix}/mint:${asset.locator.mint}`;
}

export function accountKey(account: WalletAccount) {
  const address = account.chain.family === "evm" ? account.address.toLowerCase() : account.address;
  return `${chainKey(account.chain)}/account:${address}`;
}

function validAccountAddress(account: WalletAccount) {
  return account.chain.family === "evm"
    ? EVM_ADDRESS.test(account.address)
    : SOLANA_ADDRESS.test(account.address);
}

export function assertTradeIntent(intent: TradeIntent) {
  invariant(intent.schemaVersion === VNEXT_EXECUTION_SCHEMA_VERSION, "intent schema is unsupported");
  invariant(intent.intentId.trim().length > 0, "intent identity is missing");
  invariant(validAccountAddress(intent.sourceAccount), "source account address is invalid");
  invariant(validAccountAddress(intent.recipient), "recipient account address is invalid");
  invariant(chainKey(intent.sourceAccount.chain) === chainKey(intent.inputAsset.chain), "source account chain does not match input asset");
  invariant(chainKey(intent.recipient.chain) === chainKey(intent.outputAsset.chain), "recipient chain does not match output asset");
  invariant(assetKey(intent.inputAsset) !== assetKey(intent.outputAsset), "input and output assets must differ");
  atomicAmount(intent.amountAtomic);
  invariant(Number.isSafeInteger(intent.requestedAtMs) && intent.requestedAtMs > 0, "intent timestamp is invalid");
  return true;
}

export function spendableAtomic(balance: AssetBalanceSnapshot) {
  const settled = BigInt(atomicAmount(balance.settledAtomic, { allowZero: true }));
  const outgoing = BigInt(atomicAmount(balance.pendingOutgoingAtomic, { allowZero: true }));
  const reserved = BigInt(atomicAmount(balance.reservedAtomic, { allowZero: true }));
  const unavailable = outgoing + reserved;
  return unavailable >= settled ? "0" : (settled - unavailable).toString();
}

export function candidateCanAuthorize(candidate: ExecutionCandidate, nowMs: number) {
  return candidate.policy.eligibility === "permitted"
    && candidate.policy.blockers.length === 0
    && Number.isSafeInteger(nowMs)
    && candidate.quotedAtMs <= nowMs
    && candidate.expiresAtMs > nowMs;
}

export function assertCandidateMatchesIntent(candidate: ExecutionCandidate, intent: TradeIntent, nowMs: number) {
  assertTradeIntent(intent);
  invariant(candidate.schemaVersion === VNEXT_EXECUTION_SCHEMA_VERSION, "candidate schema is unsupported");
  invariant(candidate.intentId === intent.intentId, "candidate intent changed");
  invariant(assetKey(candidate.inputAsset) === assetKey(intent.inputAsset), "candidate input asset changed");
  invariant(assetKey(candidate.outputAsset) === assetKey(intent.outputAsset), "candidate output asset changed");
  invariant(accountKey(candidate.recipient) === accountKey(intent.recipient), "candidate recipient changed");
  if (intent.tradeType === "exact_input") {
    invariant(candidate.inputAmountAtomic === atomicAmount(intent.amountAtomic), "candidate input amount changed");
    invariant(candidate.maximumInputAtomic === null, "exact-input candidate cannot set maximum input");
  } else {
    invariant(candidate.expectedOutputAtomic === atomicAmount(intent.amountAtomic), "candidate exact output changed");
    invariant(candidate.protectedOutputAtomic === intent.amountAtomic, "exact-output candidate protected output changed");
    atomicAmount(candidate.maximumInputAtomic);
  }
  atomicAmount(candidate.inputAmountAtomic);
  atomicAmount(candidate.expectedOutputAtomic);
  atomicAmount(candidate.protectedOutputAtomic);
  invariant(BigInt(candidate.protectedOutputAtomic) <= BigInt(candidate.expectedOutputAtomic), "protected output exceeds expected output");
  invariant(candidate.adapterVersion > 0 && candidate.verification.verifierVersion > 0, "adapter or verifier version is invalid");
  invariant(candidate.capabilities.length > 0 && new Set(candidate.capabilities).size === candidate.capabilities.length, "candidate capabilities are missing or duplicated");
  invariant(candidate.verification.unknownFields === "reject", "unknown provider fields must fail closed");
  invariant(chainKey(candidate.verification.expectedSourceChain) === chainKey(intent.inputAsset.chain), "verification source chain changed");
  invariant(chainKey(candidate.verification.expectedDestinationChain) === chainKey(intent.outputAsset.chain), "verification destination chain changed");
  invariant(candidate.providerQuoteRef.trim().length > 0, "provider quote reference is missing");
  invariant(Number.isSafeInteger(nowMs) && Number.isSafeInteger(candidate.quotedAtMs) && Number.isSafeInteger(candidate.expiresAtMs), "candidate timestamps are invalid");
  invariant(candidate.quotedAtMs <= nowMs && candidate.expiresAtMs > nowMs, "candidate quote is stale or from the future");
  invariant(candidate.expectedSettlementSeconds === null || (Number.isFinite(candidate.expectedSettlementSeconds) && candidate.expectedSettlementSeconds >= 0), "settlement estimate is invalid");
  for (const fee of candidate.fees) atomicAmount(fee.amountAtomic, { allowZero: true });
  return true;
}

export function assertAuthorizationPlan(plan: AuthorizationPlan, candidate: ExecutionCandidate, nowMs: number) {
  invariant(plan.schemaVersion === VNEXT_EXECUTION_SCHEMA_VERSION, "authorization schema is unsupported");
  invariant(plan.intentId === candidate.intentId && plan.candidateId === candidate.candidateId, "authorization target changed");
  invariant(plan.providerFamily === candidate.providerFamily, "authorization provider changed");
  invariant(plan.kind === candidate.authorization.kind, "authorization kind changed");
  invariant(plan.verifierId === candidate.verification.verifierId, "authorization verifier changed");
  invariant(plan.verifierVersion === candidate.verification.verifierVersion, "authorization verifier version changed");
  invariant(HASH.test(plan.payloadHash), "authorization payload hash is invalid");
  invariant(plan.payloadRef.trim().length > 0, "authorization payload reference is missing");
  invariant(plan.verifiedAtMs <= nowMs && plan.expiresAtMs > nowMs, "authorization plan is stale or from the future");
  invariant(plan.expiresAtMs <= candidate.expiresAtMs, "authorization outlives the provider quote");
  invariant(candidateCanAuthorize(candidate, nowMs), "candidate is not eligible for authorization");
  return true;
}

function selectedCandidate(session: Extract<ExecutionSession, { state: "reviewing" }>) {
  const candidate = session.candidates.find((item) => item.candidateId === session.selectedCandidateId);
  invariant(candidate, "selected candidate is missing");
  return candidate;
}

export function transitionExecutionSession(session: ExecutionSession, event: ExecutionEvent): ExecutionSession {
  if (event.type === "FAIL") {
    return { state: "failed", intent: session.intent, failureCode: event.failureCode, detail: event.detail, retryable: event.retryable };
  }
  if (event.type === "EXPIRE") return { state: "expired", intent: session.intent, detail: event.detail };
  if (event.type === "CANCEL") return { state: "cancelled", intent: session.intent, detail: event.detail };
  if (event.type === "RETRY") {
    invariant(session.state === "failed" && session.retryable || session.state === "expired", "session cannot be retried");
    return { state: "draft", intent: session.intent };
  }
  if (session.state === "draft" && event.type === "REQUEST_QUOTES") {
    return { state: "quoting", intent: session.intent, startedAtMs: event.nowMs };
  }
  if (session.state === "quoting" && event.type === "QUOTES_READY") {
    invariant(event.candidates.length > 0, "quote result is empty");
    invariant(event.candidates.some((item) => item.candidateId === event.selectedCandidateId), "selected quote is missing");
    return { state: "reviewing", intent: session.intent, candidates: event.candidates, selectedCandidateId: event.selectedCandidateId };
  }
  if (session.state === "reviewing" && event.type === "VERIFY_SELECTED") {
    return { state: "verifying", intent: session.intent, candidate: selectedCandidate(session) };
  }
  if (session.state === "verifying" && event.type === "VERIFICATION_PASSED") {
    assertAuthorizationPlan(event.plan, session.candidate, event.nowMs);
    return { state: "ready_for_authorization", intent: session.intent, candidate: session.candidate, plan: event.plan };
  }
  if (session.state === "ready_for_authorization" && event.type === "REQUEST_AUTHORIZATION") {
    assertAuthorizationPlan(session.plan, session.candidate, event.nowMs);
    return { state: "authorizing", intent: session.intent, candidate: session.candidate, plan: session.plan };
  }
  if (session.state === "authorizing" && event.type === "SUBMITTED") {
    invariant(event.settlement.status === "submitted" || event.settlement.status === "open", "submitted execution requires a pending settlement state");
    invariant(event.settlement.intentId === session.intent.intentId && event.settlement.candidateId === session.candidate.candidateId, "settlement target changed");
    return { state: "pending_settlement", intent: session.intent, candidate: session.candidate, settlement: event.settlement };
  }
  if (session.state === "pending_settlement" && event.type === "SETTLEMENT_CONFIRMED") {
    invariant(event.settlement.status === "confirmed" && event.settlement.confirmedAtMs !== null, "settlement is not confirmed");
    invariant(event.settlement.settlementId === session.settlement.settlementId, "settlement identity changed");
    atomicAmount(event.settlement.outputAmountAtomic);
    return { state: "settled", intent: session.intent, candidate: session.candidate, settlement: event.settlement };
  }
  invariant(false, `event ${event.type} is not allowed from ${session.state}`);
}
