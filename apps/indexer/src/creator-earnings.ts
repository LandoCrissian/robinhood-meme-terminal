import { isAddress, type Address, type Hash } from "viem";
import type { CurveLaunchRegistration } from "./curve-launch-evidence.js";

export const creatorEarningsProfile = "rmt-creator-earnings-v1";
export const earningsPageLimit = 50;
export const earningsCursorMaxLength = 768;
export type BeneficiaryRole = "creator" | "treasury" | "operations" | "reserve";
export type EarningsDiscoveryQuery = { recipient: Address; limit: number; after?: string; token?: Address };
export type EarningsDiscoveryCursor = {
  scope: string; recipient: Address; blockNumber: string; blockHash: Hash; after: Address;
};
export type EarningsPolicyScope = {
  binding: { chainId: 4663 | 31337; factory: Address; projectRegistry: Address; creationFeeRecipient: Address };
  reserveRecipient: Address;
};
const address = (value: unknown): value is Address => typeof value === "string"
  && isAddress(value, { strict: false }) && BigInt(value) > 0xffffn;
const hash = (value: unknown): value is Hash => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);

function parseRecipientQuery(url: URL, path: "/curve-earnings" | "/earnings", chainId: 4663 | 31337): EarningsDiscoveryQuery | null {
  const fields = [...url.searchParams.keys()];
  const recipient = url.searchParams.get("recipient");
  const token = url.searchParams.get("token") ?? undefined;
  const limit = url.searchParams.get("limit") ?? (token ? "1" : "25");
  const after = url.searchParams.get("after") ?? undefined;
  if (url.pathname !== path || fields.length > 4 || new Set(fields).size !== fields.length
      || fields.some(key => !["recipient", "limit", "after", "token"].includes(key)) || !address(recipient)
      || !/^[1-9][0-9]?$/.test(limit) || Number(limit) > earningsPageLimit
      || (token !== undefined && (!address(token) || after !== undefined || limit !== "1"))
      || (after !== undefined && !decodeEarningsDiscoveryCursor(after, chainId))) return null;
  return { recipient: recipient.toLowerCase() as Address, limit: Number(limit), ...(after ? { after } : {}),
    ...(token ? { token: token.toLowerCase() as Address } : {}) };
}
export function parseEarningsDiscoveryQuery(url: URL) { return parseRecipientQuery(url, "/curve-earnings", 4663); }
/** Explicit local fixture entry point, never used by production HTTP routing. */
export function parseFixtureEarningsDiscoveryQuery(url: URL) { return parseRecipientQuery(url, "/earnings", 31337); }

/** Pagination is not authorization. Its context must match the requested
 * recipient/deployment, and the stored canonical anchor must still exist. */
export function encodeEarningsDiscoveryCursor(cursor: EarningsDiscoveryCursor) {
  return Buffer.from(JSON.stringify([1, cursor.scope, cursor.recipient.toLowerCase(), cursor.blockNumber,
    cursor.blockHash.toLowerCase(), cursor.after.toLowerCase()]), "utf8").toString("base64url");
}

export function decodeEarningsDiscoveryCursor(text: string, chainId: 4663 | 31337 = 4663): EarningsDiscoveryCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > earningsCursorMaxLength) return null;
  try {
    const bytes = Buffer.from(text, "base64url");
    if (bytes.toString("base64url") !== text) return null;
    const data: unknown = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(data) || data.length !== 6 || data[0] !== 1 || typeof data[1] !== "string"
        || !new RegExp(`^${chainId}:0x[0-9a-f]{40}:0x[0-9a-f]{64}$`).test(data[1]) || !address(data[2])
        || typeof data[3] !== "string" || !/^[1-9][0-9]{0,15}$/.test(data[3]) || !hash(data[4]) || !address(data[5])) return null;
    return { scope: data[1], recipient: data[2].toLowerCase() as Address, blockNumber: data[3],
      blockHash: data[4].toLowerCase() as Hash, after: data[5].toLowerCase() as Address };
  } catch { return null; }
}

/** Roles describe immutable project policy, not a Safe owner's personal
 * entitlement. Earnings remain payable only to the ledger's beneficiary. */
export function earningsBeneficiaryRoles(launch: CurveLaunchRegistration, recipient: Address,
  config: EarningsPolicyScope): BeneficiaryRole[] {
  const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  if (launch.kind !== "curve-launch-1b-v2" || launch.chainId !== config.binding.chainId
      || launch.engineVersion !== 1 || launch.tokenDecimals !== 18 || launch.totalSupplyWei !== "1000000000000000000000000000"
      || !same(launch.factory, config.binding.factory) || !same(launch.projectRegistry, config.binding.projectRegistry)
      || !same(launch.creationFee.recipient, config.binding.creationFeeRecipient)
      || !address(launch.token) || !address(launch.creator) || !address(launch.revenueLedger)
      || !Number.isInteger(launch.treasuryShareBps) || launch.treasuryShareBps < 0 || launch.treasuryShareBps > 9000
      || (launch.treasury === null) !== (launch.treasuryShareBps === 0)
      || (launch.treasury !== null && (!address(launch.treasury) || same(launch.treasury, launch.creator)))) {
    throw new Error("Earnings registration policy or deployment identity mismatch");
  }
  const roles: BeneficiaryRole[] = [];
  if (same(launch.creator, recipient)) roles.push("creator");
  if (launch.treasury && same(launch.treasury, recipient)) roles.push("treasury");
  if (same(config.binding.creationFeeRecipient, recipient)) roles.push("operations");
  if (same(config.reserveRecipient, recipient)) roles.push("reserve");
  if (roles.length === 0) throw new Error("Earnings row is not related to the requested beneficiary");
  return roles;
}
