import { launchRegistrationKind, launchTokenSupplyWei } from "./launch-terms";

export const earningsProfile = "rmt-creator-earnings-v1";
export const earningsReadPath = "/api/launchpad/earnings";
export const earningsPageSize = 10;
export type EarningsRole = "creator" | "treasury" | "operations" | "reserve";
export type EarningsBlock = { blockNumber: string; blockHash: string; timestamp: string };
export type EarningsCheckpoint = EarningsBlock & { confirmations: number; finality: "l2-confirmed" | "local-synthetic"; l1Finality: "unverified" | "not-applicable" };
export type EarningsBinding = { chainId: 4663 | 31337; factory: string; registry: string; deploymentBlock: string; deploymentBlockHash: string; operations: string; reserve: string };
export type EarningsRegistration = {
  kind: typeof launchRegistrationKind; status: "created"; chainId: 4663 | 31337; engineVersion: 1;
  factory: string; projectRegistry: string; token: string; initialCurve: string; creator: string; revenueLedger: string;
  totalSupplyWei: string; tokenDecimals: 18; intentId: string; name: string; symbol: string; projectURI: string;
  treasury: string | null; treasuryShareBps: number; creation: EarningsBlock & { transactionHash: string; logIndex: number };
  projectRegistrationLogIndex: number; creationFee: { amountWei: string; refundWei: string; recipient: string; logIndex: number };
  opening?: { inventoryWei: string; backingWei: string; soldWei: string };
  checkpoint: EarningsBlock & { confirmations: number; finality: "l2-confirmed" | "fixture-confirmed"; l1Finality: "unverified" };
  beneficiaryRoles: EarningsRole[]; feeEvidence: "contract-read-required";
};
export type EarningsDirectory = {
  schemaVersion: 1; profile: typeof earningsProfile; chainId: 4663 | 31337; recipient: string;
  status: "ready" | "stale"; observedAt: string; checkpoint: EarningsCheckpoint;
  deployment: { factory: string; registry: string; blockNumber: string; blockHash: string };
  launches: EarningsRegistration[]; nextCursor: string | null;
  history: { status: "unsupported"; source: "historical-v4-v6"; feeEvidence: string };
};
export type EarningsHistory = { status: "ready" | "stale" | "unavailable"; records: Array<{
  token: string; name: string; symbol: string; version: 4 | 6; roles: string[]; transactionHash: string;
}>; nextCursor: string | null; feeEvidence: "unsupported-historical-adapter" };
export type EarningsResponse = { status: "unavailable"; reason: string; execution: "disabled" } | EarningsDirectory & {
  mode: "read-only" | "isolated-test"; execution: "disabled" | "isolated-test"; historical: EarningsHistory;
};

export const earningsAddress = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && BigInt(value) > 0xffffn;
export const earningsHash = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0+$/i.test(value);
export const earningsWei = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
export const sameEarningsAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const blockNumber = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const label = (v: unknown, limit: number): v is string => typeof v === "string" && v.length > 0 && v.length <= limit && !/[\p{Cc}\p{Cf}]/u.test(v);
const same = sameEarningsAddress;
const within = (a: EarningsBlock, b: EarningsBlock) => BigInt(a.blockNumber) <= BigInt(b.blockNumber)
  && Date.parse(a.timestamp) <= Date.parse(b.timestamp) && (a.blockNumber !== b.blockNumber || same(a.blockHash, b.blockHash));
function evidence(value: unknown): value is EarningsBlock {
  const b = value as Partial<EarningsBlock> | null;
  return !!b && blockNumber(b.blockNumber) && earningsHash(b.blockHash) && timestamp(b.timestamp);
}
export function rolesForEarnings(recipient: string, registration: Pick<EarningsRegistration, "creator" | "treasury">, binding: EarningsBinding): EarningsRole[] {
  return (["creator", "treasury", "operations", "reserve"] as const).filter(role => {
    const wallet = role === "creator" || role === "treasury" ? registration[role] : binding[role];
    return wallet !== null && same(recipient, wallet);
  });
}

/** Validates the discovery protocol without treating an indexed address as
 * execution permission. Contract balances require their separate runtime read. */
export function parseEarningsDirectory(raw: unknown, binding: EarningsBinding, recipient: string, now = Date.now()): EarningsDirectory | null {
  try {
    const d = raw as EarningsDirectory;
    const p = d.checkpoint;
    if (!d || d.schemaVersion !== 1 || d.profile !== earningsProfile || d.chainId !== binding.chainId || !earningsAddress(recipient)
      || !same(d.recipient, recipient) || !["ready", "stale"].includes(d.status) || !timestamp(d.observedAt)
      || Date.parse(d.observedAt) > now + 15_000 || !evidence(p) || BigInt(p.blockNumber) < BigInt(binding.deploymentBlock)
      || (binding.chainId === 4663 && Date.parse(p.timestamp) > now + 15_000) || !Number.isInteger(p.confirmations)
      || (binding.chainId === 4663 ? p.finality !== "l2-confirmed" || p.l1Finality !== "unverified" || p.confirmations < 20
        : p.finality !== "local-synthetic" || p.l1Finality !== "not-applicable" || p.confirmations < 2)
      || p.confirmations > 256 || !same(d.deployment.factory, binding.factory) || !same(d.deployment.registry, binding.registry)
      || d.deployment.blockNumber !== binding.deploymentBlock || !same(d.deployment.blockHash, binding.deploymentBlockHash)
      || !Array.isArray(d.launches) || d.launches.length > 50 || (d.nextCursor !== null && (typeof d.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,768}$/.test(d.nextCursor)))
      || d.history.status !== "unsupported" || d.history.source !== "historical-v4-v6") return null;
    const seen = new Set<string>();
    const launches = d.launches.map(r => {
      if (r.kind !== launchRegistrationKind || r.status !== "created" || r.chainId !== binding.chainId || r.engineVersion !== 1
        || ![r.factory, r.projectRegistry, r.token, r.initialCurve, r.creator, r.revenueLedger].every(earningsAddress)
        || !same(r.factory, binding.factory) || !same(r.projectRegistry, binding.registry) || !earningsHash(r.intentId)
        || r.totalSupplyWei !== launchTokenSupplyWei.toString() || r.tokenDecimals !== 18 || !label(r.name, 48) || !label(r.symbol, 12)
        || typeof r.projectURI !== "string" || r.projectURI.length > 196 || !Number.isInteger(r.treasuryShareBps)
        || r.treasuryShareBps < 0 || r.treasuryShareBps > 9000 || (r.treasury === null) !== (r.treasuryShareBps === 0)
        || (r.treasury !== null && (!earningsAddress(r.treasury) || same(r.treasury, r.creator)))
        || !evidence(r.creation) || !within(r.creation, p) || BigInt(r.creation.blockNumber) < BigInt(binding.deploymentBlock)
        || !evidence(r.checkpoint) || !within(r.creation, r.checkpoint) || !within(r.checkpoint, p)
        || r.checkpoint.finality !== (binding.chainId === 4663 ? "l2-confirmed" : "fixture-confirmed")
        || r.checkpoint.l1Finality !== "unverified" || !Number.isInteger(r.checkpoint.confirmations)
        || r.checkpoint.confirmations < (binding.chainId === 4663 ? 20 : 2)
        || !earningsHash(r.creation.transactionHash) || !Number.isSafeInteger(r.creation.logIndex) || r.creation.logIndex < 0
        || !Number.isSafeInteger(r.projectRegistrationLogIndex) || r.projectRegistrationLogIndex < 0
        || r.creationFee.amountWei !== "400000000000000" || !earningsWei(r.creationFee.refundWei) || !same(r.creationFee.recipient, binding.operations)
        || !Number.isSafeInteger(r.creationFee.logIndex) || r.creationFee.logIndex <= r.creation.logIndex
        || r.feeEvidence !== "contract-read-required" || seen.has(r.token.toLowerCase())) throw new Error("Unverified earnings registration");
      const roles = rolesForEarnings(recipient, r, binding);
      if (!roles.length || !Array.isArray(r.beneficiaryRoles) || roles.length !== r.beneficiaryRoles.length || roles.some(role => !r.beneficiaryRoles.includes(role))) throw new Error("Wrong beneficiary");
      seen.add(r.token.toLowerCase());
      // Only known, public registration fields leave this boundary.
      return { kind: r.kind, status: r.status, chainId: r.chainId, engineVersion: r.engineVersion, factory: r.factory, projectRegistry: r.projectRegistry,
        token: r.token, initialCurve: r.initialCurve, creator: r.creator, revenueLedger: r.revenueLedger, totalSupplyWei: r.totalSupplyWei,
        tokenDecimals: r.tokenDecimals, intentId: r.intentId, name: r.name, symbol: r.symbol, projectURI: r.projectURI, treasury: r.treasury,
        treasuryShareBps: r.treasuryShareBps, creation: { blockNumber: r.creation.blockNumber, blockHash: r.creation.blockHash,
          timestamp: r.creation.timestamp, transactionHash: r.creation.transactionHash, logIndex: r.creation.logIndex },
        projectRegistrationLogIndex: r.projectRegistrationLogIndex, creationFee: { amountWei: r.creationFee.amountWei,
          refundWei: r.creationFee.refundWei, recipient: r.creationFee.recipient, logIndex: r.creationFee.logIndex },
        checkpoint: { blockNumber: r.checkpoint.blockNumber, blockHash: r.checkpoint.blockHash, timestamp: r.checkpoint.timestamp,
          confirmations: r.checkpoint.confirmations, finality: r.checkpoint.finality, l1Finality: r.checkpoint.l1Finality },
        beneficiaryRoles: roles, feeEvidence: "contract-read-required" as const };
    });
    return { schemaVersion: 1, profile: earningsProfile, chainId: binding.chainId, recipient: recipient.toLowerCase(),
      status: d.status === "stale" || now - Date.parse(binding.chainId === 4663 ? p.timestamp : d.observedAt) > 120_000 ? "stale" : "ready", observedAt: d.observedAt,
      deployment: { factory: binding.factory, registry: binding.registry, blockNumber: binding.deploymentBlock, blockHash: binding.deploymentBlockHash },
      checkpoint: { blockNumber: p.blockNumber, blockHash: p.blockHash, timestamp: p.timestamp, confirmations: p.confirmations, finality: p.finality, l1Finality: p.l1Finality },
      launches, nextCursor: d.nextCursor, history: { status: "unsupported", source: "historical-v4-v6", feeEvidence: "Historical fee contracts require a separately verified adapter." } };
  } catch { return null; }
}

export function earningsAmount(value: string, symbol = "ETH") {
  if (!earningsWei(value)) return "Unavailable";
  const n = BigInt(value), whole = n / 10n ** 18n, fraction = (n % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  if (!n) return `0 ${symbol}`;
  if (!whole && fraction.length > 8 && fraction.slice(0, 8) === "00000000") return `<0.00000001 ${symbol}`;
  const visible = fraction.slice(0, 8).replace(/0+$/, "");
  return `${whole}${visible ? "." + visible : ""} ${symbol}`;
}
