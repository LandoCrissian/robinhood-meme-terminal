import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import type {
  VNextEcosystemIntelligence,
  VNextUpGaugeState,
  VNextUpMarketIntelligence
} from "../vnext/ecosystem-intelligence";
import {
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import {
  UP_CL_FACTORY,
  UP_CL_FACTORY_RUNTIME_HASH,
  UP_V2_FACTORY,
  UP_V2_FACTORY_RUNTIME_HASH
} from "./vnext-up-quote";

const UP_VOTER = getAddress("0x7F749fDD351C1Ceed82d76d7699CB631Eb8332a7");
const UP_VOTER_RUNTIME_HASH = "0xd3805b025dfd7d910cb3658b759688ecc3d5e839d28fe43a763c4722ffe2a513" as Hex;
const MAX_TICK_SPACINGS = 16;
const QUOTE_TOKENS = [ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS] as const;

const v2FactoryAbi = [{
  type: "function", name: "getPool", stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "stable", type: "bool" }],
  outputs: [{ name: "pool", type: "address" }]
}, {
  type: "function", name: "isPool", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "registered", type: "bool" }]
}, {
  type: "function", name: "getFee", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }, { name: "stable", type: "bool" }], outputs: [{ name: "fee", type: "uint256" }]
}] as const;

const clFactoryAbi = [{
  type: "function", name: "tickSpacings", stateMutability: "view", inputs: [], outputs: [{ name: "spacings", type: "int24[]" }]
}, {
  type: "function", name: "getPool", stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "tickSpacing", type: "int24" }],
  outputs: [{ name: "pool", type: "address" }]
}, {
  type: "function", name: "isPool", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "registered", type: "bool" }]
}] as const;

const poolAbi = [{
  type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "token", type: "address" }]
}, {
  type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "token", type: "address" }]
}, {
  type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ name: "fee", type: "uint24" }]
}, {
  type: "function", name: "stable", stateMutability: "view", inputs: [], outputs: [{ name: "stable", type: "bool" }]
}, {
  type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ name: "tickSpacing", type: "int24" }]
}] as const;

const voterAbi = [{
  type: "function", name: "gauges", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "gauge", type: "address" }]
}, {
  type: "function", name: "isAlive", stateMutability: "view",
  inputs: [{ name: "gauge", type: "address" }], outputs: [{ name: "alive", type: "bool" }]
}, {
  type: "function", name: "weights", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "weight", type: "uint256" }]
}, {
  type: "function", name: "claimable", stateMutability: "view",
  inputs: [{ name: "gauge", type: "address" }], outputs: [{ name: "amount", type: "uint256" }]
}, {
  type: "function", name: "gaugeToFees", stateMutability: "view",
  inputs: [{ name: "gauge", type: "address" }], outputs: [{ name: "fees", type: "address" }]
}, {
  type: "function", name: "gaugeToBribe", stateMutability: "view",
  inputs: [{ name: "gauge", type: "address" }], outputs: [{ name: "bribe", type: "address" }]
}] as const;

type Snapshot = Readonly<{ blockNumber: bigint; blockHash: Hex }>;

export type VNextEcosystemReader = Readonly<{
  snapshot(): Promise<Snapshot>;
  confirmSnapshot(snapshot: Snapshot): Promise<void>;
  verifyDependencies(snapshot: Snapshot): Promise<void>;
  clTickSpacings(snapshot: Snapshot): Promise<readonly number[]>;
  v2Pool(token: Address, quote: Address, stable: boolean, snapshot: Snapshot): Promise<Address>;
  clPool(token: Address, quote: Address, tickSpacing: number, snapshot: Snapshot): Promise<Address>;
  poolRegistration(pool: Address, snapshot: Snapshot): Promise<Readonly<{ v2: boolean; cl: boolean }>>;
  v2Stable(pool: Address, snapshot: Snapshot): Promise<boolean>;
  v2PoolEvidence(pool: Address, stable: boolean, snapshot: Snapshot): Promise<Readonly<{ recognized: boolean; token0: Address; token1: Address; fee: number; tickSpacing: null }>>;
  clPoolEvidence(pool: Address, snapshot: Snapshot): Promise<Readonly<{ recognized: boolean; token0: Address; token1: Address; fee: number; tickSpacing: number }>>;
  gaugeEvidence(pool: Address, snapshot: Snapshot): Promise<Readonly<{
    gaugeState: VNextUpGaugeState;
    gaugeAddress: Address | null;
    gaugeWeight: string | null;
    gaugeClaimable: string | null;
    feesAddress: Address | null;
    bribeAddress: Address | null;
  }>>;
}>;

function rpcUrl() {
  const value = process.env.RMT_VNEXT_UP_RPC_URL?.trim()
    || process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || robinhoodChain.rpcUrls.default.http[0];
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("up. ecosystem RPC must use HTTPS without embedded credentials");
  }
  return value;
}

function exactBlockHash(value: Hex | null) {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("up. ecosystem block hash is unavailable");
  return value.toLowerCase() as Hex;
}

function assertRuntime(code: Hex | undefined, expected: Hex, label: string) {
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} runtime bytecode is not approved`);
  }
}

function liveReader(client: PublicClient): VNextEcosystemReader {
  return {
    async snapshot() {
      const block = await client.getBlock({ blockTag: "latest" });
      return { blockNumber: block.number, blockHash: exactBlockHash(block.hash) };
    },
    async confirmSnapshot(snapshot) {
      const block = await client.getBlock({ blockNumber: snapshot.blockNumber });
      if (exactBlockHash(block.hash) !== snapshot.blockHash) throw new Error("up. ecosystem observation block was reorganized");
    },
    async verifyDependencies(snapshot) {
      const [v2Factory, clFactory, voter] = await Promise.all([
        client.getBytecode({ address: UP_V2_FACTORY, blockNumber: snapshot.blockNumber }),
        client.getBytecode({ address: UP_CL_FACTORY, blockNumber: snapshot.blockNumber }),
        client.getBytecode({ address: UP_VOTER, blockNumber: snapshot.blockNumber })
      ]);
      assertRuntime(v2Factory, UP_V2_FACTORY_RUNTIME_HASH, "up v2 factory");
      assertRuntime(clFactory, UP_CL_FACTORY_RUNTIME_HASH, "up CL factory");
      assertRuntime(voter, UP_VOTER_RUNTIME_HASH, "up voter");
    },
    async clTickSpacings(snapshot) {
      return await client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "tickSpacings", blockNumber: snapshot.blockNumber });
    },
    v2Pool: (token, quote, stable, snapshot) => client.readContract({
      address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "getPool", args: [token, quote, stable], blockNumber: snapshot.blockNumber
    }),
    clPool: (token, quote, tickSpacing, snapshot) => client.readContract({
      address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "getPool", args: [token, quote, tickSpacing], blockNumber: snapshot.blockNumber
    }),
    async poolRegistration(pool, snapshot) {
      const [v2, cl] = await Promise.all([
        client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "isPool", args: [pool], blockNumber: snapshot.blockNumber }),
        client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "isPool", args: [pool], blockNumber: snapshot.blockNumber })
      ]);
      return { v2, cl };
    },
    v2Stable: (pool, snapshot) => client.readContract({
      address: pool, abi: poolAbi, functionName: "stable", blockNumber: snapshot.blockNumber
    }),
    async v2PoolEvidence(pool, stable, snapshot) {
      const [recognized, token0, token1, fee] = await Promise.all([
        client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "isPool", args: [pool], blockNumber: snapshot.blockNumber }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "token0", blockNumber: snapshot.blockNumber }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "token1", blockNumber: snapshot.blockNumber }),
        client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "getFee", args: [pool, stable], blockNumber: snapshot.blockNumber })
      ]);
      if (fee > 300n) throw new Error("up v2 live fee is outside the reviewed domain");
      return { recognized, token0: getAddress(token0), token1: getAddress(token1), fee: Number(fee), tickSpacing: null };
    },
    async clPoolEvidence(pool, snapshot) {
      const [recognized, token0, token1, fee, tickSpacing] = await Promise.all([
        client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "isPool", args: [pool], blockNumber: snapshot.blockNumber }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "token0", blockNumber: snapshot.blockNumber }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "token1", blockNumber: snapshot.blockNumber }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "fee", blockNumber: snapshot.blockNumber }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "tickSpacing", blockNumber: snapshot.blockNumber })
      ]);
      if (fee > 1_000_000) throw new Error("up CL live fee is outside the reviewed domain");
      if (!Number.isSafeInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 16_383) throw new Error("up CL tick spacing is outside the reviewed domain");
      return { recognized, token0: getAddress(token0), token1: getAddress(token1), fee: Number(fee), tickSpacing };
    },
    async gaugeEvidence(pool, snapshot) {
      const gauge = await client.readContract({ address: UP_VOTER, abi: voterAbi, functionName: "gauges", args: [pool], blockNumber: snapshot.blockNumber });
      if (gauge === zeroAddress) return {
        gaugeState: "none", gaugeAddress: null, gaugeWeight: null, gaugeClaimable: null, feesAddress: null, bribeAddress: null
      };
      try {
        const [alive, weight, claimable, fees, bribe] = await Promise.all([
          client.readContract({ address: UP_VOTER, abi: voterAbi, functionName: "isAlive", args: [gauge], blockNumber: snapshot.blockNumber }),
          client.readContract({ address: UP_VOTER, abi: voterAbi, functionName: "weights", args: [pool], blockNumber: snapshot.blockNumber }),
          client.readContract({ address: UP_VOTER, abi: voterAbi, functionName: "claimable", args: [gauge], blockNumber: snapshot.blockNumber }),
          client.readContract({ address: UP_VOTER, abi: voterAbi, functionName: "gaugeToFees", args: [gauge], blockNumber: snapshot.blockNumber }),
          client.readContract({ address: UP_VOTER, abi: voterAbi, functionName: "gaugeToBribe", args: [gauge], blockNumber: snapshot.blockNumber })
        ]);
        if (fees === zeroAddress || bribe === zeroAddress) throw new Error("up gauge destinations are incomplete");
        return {
          gaugeState: alive ? "live" : "inactive",
          gaugeAddress: getAddress(gauge),
          gaugeWeight: weight.toString(),
          gaugeClaimable: claimable.toString(),
          feesAddress: getAddress(fees),
          bribeAddress: getAddress(bribe)
        };
      } catch {
        return {
          gaugeState: "unavailable", gaugeAddress: getAddress(gauge), gaugeWeight: null, gaugeClaimable: null, feesAddress: null, bribeAddress: null
        };
      }
    }
  };
}

let defaultReader: VNextEcosystemReader | null = null;

function reader() {
  if (!defaultReader) {
    defaultReader = liveReader(createPublicClient({
      chain: robinhoodChain,
      transport: http(rpcUrl(), { retryCount: 1, timeout: 5_000, batch: { batchSize: 64, wait: 0 } })
    }));
  }
  return defaultReader;
}

function exactPair(token: Address, quote: Address, token0: Address, token1: Address) {
  const expected = [token.toLowerCase(), quote.toLowerCase()].sort();
  const observed = [token0.toLowerCase(), token1.toLowerCase()].sort();
  return expected[0] === observed[0] && expected[1] === observed[1];
}

function stonkBoundary() {
  return Object.freeze({
    sourceId: "stonkbrokers" as const,
    sourceName: "StonkBrokers" as const,
    attributionState: "production-source-unverified" as const,
    tokenCreated: false as const,
    sourceListed: false as const,
    authoritative: false as const
  });
}

export async function readVNextEcosystemIntelligence(
  rawToken: Address,
  source: VNextEcosystemReader = reader(),
  now = () => new Date(),
  displayedPools: readonly Address[] = []
): Promise<VNextEcosystemIntelligence> {
  const token = getAddress(rawToken);
  const quotes = QUOTE_TOKENS.filter((quote) => quote !== token);
  const snapshot = await source.snapshot();
  await source.verifyDependencies(snapshot);
  const tickSpacings = [...new Set(await source.clTickSpacings(snapshot))];
  if (
    tickSpacings.length < 1
    || tickSpacings.length > MAX_TICK_SPACINGS
    || tickSpacings.some((spacing) => !Number.isSafeInteger(spacing) || spacing < 1 || spacing > 16_383)
  ) throw new Error("up CL tick spacing registry is outside the reviewed domain");

  const discoveredCandidates = await Promise.all([
    ...quotes.flatMap((quote) => [false, true].map(async (stable) => ({
      venue: "up-v2" as const,
      quote,
      stable,
      tickSpacing: null,
      pool: await source.v2Pool(token, quote, stable, snapshot)
    }))),
    ...quotes.flatMap((quote) => tickSpacings.map(async (tickSpacing) => ({
      venue: "up-cl" as const,
      quote,
      stable: null,
      tickSpacing,
      pool: await source.clPool(token, quote, tickSpacing, snapshot)
    })))
  ]);

  const displayedCandidates = (await Promise.all([...new Map(displayedPools.map((pool) => [pool.toLowerCase(), getAddress(pool)])).values()].map(async (pool) => {
    const registration = await source.poolRegistration(pool, snapshot);
    if (registration.v2 === registration.cl) return null;
    if (registration.v2) {
      const stable = await source.v2Stable(pool, snapshot);
      const evidence = await source.v2PoolEvidence(pool, stable, snapshot);
      if (!evidence.recognized) return null;
      const quote = evidence.token0 === token ? evidence.token1 : evidence.token1 === token ? evidence.token0 : null;
      return quote ? { venue: "up-v2" as const, quote, stable, tickSpacing: null, pool } : null;
    }
    const evidence = await source.clPoolEvidence(pool, snapshot);
    if (!evidence.recognized) return null;
    const quote = evidence.token0 === token ? evidence.token1 : evidence.token1 === token ? evidence.token0 : null;
    return quote ? { venue: "up-cl" as const, quote, stable: null, tickSpacing: null, pool } : null;
  }))).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const candidates = [...discoveredCandidates, ...displayedCandidates];

  let partial = false;
  const markets = (await Promise.all(candidates.filter((candidate) => candidate.pool !== zeroAddress).map(async (candidate): Promise<VNextUpMarketIntelligence | null> => {
    try {
      const pool = getAddress(candidate.pool);
      const poolEvidence = candidate.venue === "up-v2"
        ? await source.v2PoolEvidence(pool, candidate.stable!, snapshot)
        : await source.clPoolEvidence(pool, snapshot);
      if (!poolEvidence.recognized || !exactPair(token, candidate.quote, poolEvidence.token0, poolEvidence.token1)) {
        throw new Error("up pool identity does not match the requested asset pair");
      }
      const gauge = await source.gaugeEvidence(pool, snapshot);
      if (gauge.gaugeState === "unavailable") partial = true;
      return Object.freeze({
        venue: candidate.venue,
        poolAddress: pool,
        token0: poolEvidence.token0,
        token1: poolEvidence.token1,
        quoteToken: candidate.quote,
        stable: candidate.stable,
        tickSpacing: candidate.venue === "up-cl" ? candidate.tickSpacing ?? poolEvidence.tickSpacing : null,
        liveFee: poolEvidence.fee,
        feeDenominator: candidate.venue === "up-v2" ? 10_000 as const : 1_000_000 as const,
        ...gauge
      });
    } catch {
      partial = true;
      return null;
    }
  }))).filter((market): market is VNextUpMarketIntelligence => market !== null);

  await source.confirmSnapshot(snapshot);
  const uniqueMarkets = [...new Map(markets.map((market) => [market.poolAddress.toLowerCase(), market])).values()]
    .sort((left, right) => left.venue.localeCompare(right.venue) || left.poolAddress.localeCompare(right.poolAddress));
  return Object.freeze({
    chainId: 4_663,
    token,
    status: partial ? "partial" : "ready",
    authoritative: true,
    observedBlock: snapshot.blockNumber.toString(),
    observedBlockHash: snapshot.blockHash,
    observedAt: now().toISOString(),
    upMarkets: Object.freeze(uniqueMarkets),
    stonkBrokers: stonkBoundary()
  });
}
