import { getAddress, type Address } from "viem";
import {
  ROBINHOOD_ETH,
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_NATIVE_ASSET_ADDRESS
} from "../vnext/robinhood-assets";
import { readVNextCanonicalMarketInventory } from "./vnext-market-indexer";
import type { RobinhoodTokenIdentityEvidence } from "./universal-market-resolver";

export type VNextIdentityConflict = "contract_invalid" | "decimals_conflict";
export class VNextExecutionIdentityConflictError extends Error {
  readonly code = "VNEXT_EXECUTION_IDENTITY_CONFLICT";
  readonly status = 409;
  readonly phase = "IDENTITY_CONFLICT";
  constructor(readonly reason: VNextIdentityConflict) {
    super("Token identity conflicts with verified contract evidence.");
    this.name = "VNextExecutionIdentityConflictError";
  }
}

export function vNextExecutionIdentityErrorResponse(cause: unknown): Response | null {
  return cause instanceof VNextExecutionIdentityConflictError
    ? Response.json({
        error: "Token identity conflicts with verified contract evidence.",
        code: "VNEXT_EXECUTION_IDENTITY_CONFLICT",
        phase: "IDENTITY_CONFLICT"
      }, { status: 409, headers: { "Cache-Control": "no-store" } })
    : null;
}

export type VNextTrustedAssetIdentity = Readonly<{
  address: Address;
  chainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  name: string;
  symbol: string;
  decimals: number;
  native: boolean;
  provenance: "robinhood-native-asset" | "verified-token-identity-index" | "verified-onchain-token-identity";
  sourceManifestHash: string | null;
  freshness: "local" | "last-known" | "current";
}>;

export type VNextExecutionIdentityReadOptions = {
  chainId?: number;
  // Pass task => after(task) from an owned request lifecycle. No hook means no
  // background work; unknown identities can still require an awaited live read.
  scheduleRevalidation?: (task: () => Promise<void>) => void;
};
export type VNextExecutionIdentityDependencies = {
  readInventory?: typeof readVNextCanonicalMarketInventory;
  readLive: (address: Address) => Promise<RobinhoodTokenIdentityEvidence>;
  now?: () => number;
  revalidateAfterMs?: number;
  deadlineMs?: number;
  inventoryDeadlineMs?: number;
  freshReadDeadlineMs?: number;
  maximumEntries?: number;
  maximumPending?: number;
  maximumConflicts?: number;
};

type Entry = {
  identity: VNextTrustedAssetIdentity | null;
  generation: number;
  nextReadAt: number;
  nextValidationAt: number;
  loading?: Promise<void>;
  scheduled?: object;
};
const INVENTORY_LIMIT = 16;
const RETRY_MS = 5_000;
function bound(value: number | undefined, fallback: number, maximum: number) {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum) : fallback;
}

/** RMT_EXECUTION_HOT_PATH_DECOUPLING_V1. Identity does not grant project/route admission. */
export function createVNextExecutionIdentityAuthority(dependencies: VNextExecutionIdentityDependencies) {
  const inventory = dependencies.readInventory ?? readVNextCanonicalMarketInventory;
  const now = dependencies.now ?? Date.now;
  const interval = bound(dependencies.revalidateAfterMs, 60_000, 300_000);
  const deadline = bound(dependencies.deadlineMs, 2_000, 10_000);
  const inventoryDeadline = bound(dependencies.inventoryDeadlineMs, 5_000, 5_000);
  const freshDeadline = bound(dependencies.freshReadDeadlineMs, 5_000, 10_000);
  const maximumEntries = bound(dependencies.maximumEntries, 1_024, 4_096);
  const maximumPending = bound(dependencies.maximumPending, 16, 64);
  const maximumConflicts = bound(dependencies.maximumConflicts, 1_024, 4_096);
  const entries = new Map<string, Entry>();
  // Conflict tombstones are independent of the evictable ordinary LRU cache.
  const conflicts = new Map<string, VNextIdentityConflict>();
  let conflictSpaceExhausted = false;
  let pending = 0;
  let durablePending = 0;

  function binding(address: Address, chainId: number = ROBINHOOD_MAINNET_CHAIN_ID) {
    if (chainId !== ROBINHOOD_MAINNET_CHAIN_ID) return null;
    try {
      const normalized = getAddress(address);
      return { address: normalized, key: `${chainId}:${normalized.toLowerCase()}` };
    } catch { return null; }
  }
  function requireNoConflict(key: string) {
    const reason = conflicts.get(key);
    if (reason) throw new VNextExecutionIdentityConflictError(reason);
  }
  function current(key: string, entry: Entry, generation: number) {
    return !conflictSpaceExhausted && !conflicts.has(key)
      && entries.get(key) === entry && entry.generation === generation;
  }
  async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation.catch(() => undefined),
        new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), timeoutMs); })
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  function blockOnPositiveConflict(address: Address, reason: VNextIdentityConflict, chainId: number = ROBINHOOD_MAINNET_CHAIN_ID) {
    const target = binding(address, chainId);
    if (!target || target.address === ROBINHOOD_NATIVE_ASSET_ADDRESS
      || (reason !== "contract_invalid" && reason !== "decimals_conflict")) return;
    if (!conflicts.has(target.key)) {
      if (conflicts.size >= maximumConflicts) conflictSpaceExhausted = true;
      else conflicts.set(target.key, reason);
    }
    const entry = entries.get(target.key);
    if (entry) { entry.generation++; entry.identity = null; }
    entries.delete(target.key);
  }

  function usableLiveToken(evidence: RobinhoodTokenIdentityEvidence | undefined, address: Address) {
    if (evidence?.status !== "verified_token") return null;
    const token = evidence.token;
    if (typeof token.address !== "string" || token.address.toLowerCase() !== address.toLowerCase()) return null;
    const text = (value: unknown, maximum: number) => typeof value === "string"
      && value.length > 0 && value.length <= maximum && value === value.trim()
      && !/[\u0000-\u001f\u007f]/.test(value);
    if (!text(token.name, 80) || !text(token.symbol, 20)
      || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36
      || typeof token.totalSupply !== "string" || !/^[1-9][0-9]{0,77}$/.test(token.totalSupply)) {
      blockOnPositiveConflict(address, "contract_invalid");
      return null;
    }
    return token;
  }

  async function fresh(address: Address, key: string, entry: Entry, generation: number) {
    if (pending >= maximumPending) return;
    pending++;
    const operation = Promise.resolve().then(() => dependencies.readLive(address))
      .finally(() => { pending--; });
    const evidence = await bounded(operation, freshDeadline);
    if (!current(key, entry, generation)) return;
    if (evidence?.status === "not_erc20") { blockOnPositiveConflict(address, "contract_invalid"); return; }
    const token = usableLiveToken(evidence, address);
    if (!token || !current(key, entry, generation)) return;
    entry.identity = Object.freeze({
      address, chainId: ROBINHOOD_MAINNET_CHAIN_ID, name: token.name, symbol: token.symbol,
      decimals: token.decimals, native: false, provenance: "verified-onchain-token-identity",
      sourceManifestHash: null, freshness: "current"
    });
    entry.nextValidationAt = now() + interval;
  }

  async function hydrate(address: Address, key: string, entry: Entry) {
    const generation = entry.generation;
    if (durablePending < maximumPending) {
      durablePending++;
      // Bound the entire response, including body parsing. Underlying operations
      // retain their physical slots after timeout, so slow I/O cannot fan out.
      const operation = Promise.resolve().then(() => inventory(
        { token: address, limit: INVENTORY_LIMIT }, { includeBrowseIdentities: true }
      )).finally(() => { durablePending--; });
      const result = await bounded(operation, inventoryDeadline);
      if (!current(key, entry, generation)) return;
      const exact = address.toLowerCase();
      if (result?.status === "verified_shadow" && result.chainId === ROBINHOOD_MAINNET_CHAIN_ID
        && result.browseIdentities?.source === "verified-token-identity-index"
        && result.browseIdentities.freshness === "last-known"
        && result.pools.length > 0 && result.pools.length <= INVENTORY_LIMIT
        && result.pools.every((pool) => pool.token0 === exact || pool.token1 === exact)) {
        // The real inventory reader authenticates and strictly validates the
        // response, including every identity's page binding and uniqueness.
        const identities = result.browseIdentities.identities.filter((item) => item.address === exact);
        if (identities.length === 1) {
          entry.identity = Object.freeze({
            ...identities[0], address, chainId: ROBINHOOD_MAINNET_CHAIN_ID, native: false,
            provenance: "verified-token-identity-index", sourceManifestHash: result.sourceManifestHash,
            freshness: "last-known"
          });
          return;
        }
      }
    }
    if (!current(key, entry, generation)) return;
    await fresh(address, key, entry, generation);
    entry.nextReadAt = now() + RETRY_MS;
  }

  function schedule(address: Address, key: string, entry: Entry, hook: VNextExecutionIdentityReadOptions["scheduleRevalidation"]) {
    if (!hook || !entry.identity || entry.scheduled || conflicts.has(key)
      || pending >= maximumPending || now() < entry.nextValidationAt) return;
    const ticket = {};
    entry.scheduled = ticket;
    pending++;
    let started = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      pending--;
      if (entry.scheduled === ticket) entry.scheduled = undefined;
    };
    const task = async () => {
      if (started || released) return;
      started = true;
      const generation = ++entry.generation;
      const original = entry.identity;
      if (!original || !current(key, entry, generation)) { release(); return; }
      entry.nextValidationAt = now() + interval;
      const operation = Promise.resolve().then(() => dependencies.readLive(address));
      // A timed-out transport keeps its physical slot until it settles. Its
      // late result cannot overwrite metadata or reverse a positive conflict.
      void operation.then(release, release);
      const evidence = await bounded(operation, deadline);
      if (!current(key, entry, generation)) return;
      if (evidence?.status === "not_erc20") { blockOnPositiveConflict(address, "contract_invalid"); return; }
      const token = usableLiveToken(evidence, address);
      if (!token || !current(key, entry, generation)) return;
      if (token.decimals !== original.decimals) blockOnPositiveConflict(address, "decimals_conflict");
      else entry.identity = Object.freeze({ ...original, freshness: "current" });
    };
    try { hook(task); } catch {
      // Failed registration must not break reads or start unowned work.
      if (!started) release();
    }
  }

  async function read(address: Address, options: VNextExecutionIdentityReadOptions = {}): Promise<VNextTrustedAssetIdentity | null> {
    const target = binding(address, options.chainId);
    if (!target) return null;
    if (target.address === ROBINHOOD_NATIVE_ASSET_ADDRESS) {
      if (ROBINHOOD_ETH.decimals === null || !ROBINHOOD_ETH.symbol || !ROBINHOOD_ETH.name) return null;
      return Object.freeze({
        address: ROBINHOOD_NATIVE_ASSET_ADDRESS, chainId: ROBINHOOD_MAINNET_CHAIN_ID,
        name: ROBINHOOD_ETH.name, symbol: ROBINHOOD_ETH.symbol, decimals: ROBINHOOD_ETH.decimals,
        native: true, provenance: "robinhood-native-asset", sourceManifestHash: null, freshness: "local"
      });
    }
    requireNoConflict(target.key);
    if (conflictSpaceExhausted) return null;
    let entry = entries.get(target.key);
    if (!entry) {
      if (entries.size >= maximumEntries) {
        const victim = [...entries].find(([, value]) => !value.loading && !value.scheduled);
        if (!victim) return null; // All bounded slots are actively owned.
        entries.delete(victim[0]);
      }
      entry = { identity: null, generation: 0, nextReadAt: 0, nextValidationAt: 0 };
    }
    // Touch ordinary entries in LRU order. Conflict tombstones never enter LRU.
    entries.delete(target.key);
    entries.set(target.key, entry);
    if (!entry.identity) {
      if (!entry.loading && now() >= entry.nextReadAt) {
        entry.loading = hydrate(target.address, target.key, entry).finally(() => { entry.loading = undefined; });
      }
      await entry.loading;
    }
    requireNoConflict(target.key);
    if (conflictSpaceExhausted || entries.get(target.key) !== entry) return null;
    schedule(target.address, target.key, entry, options.scheduleRevalidation);
    return entry.identity;
  }

  return { read, blockOnPositiveConflict };
}
