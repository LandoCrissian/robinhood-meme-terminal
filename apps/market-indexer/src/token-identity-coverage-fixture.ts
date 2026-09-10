// Test storage only. The Production worker remains the sole shard writer.
import { gunzipSync, gzipSync } from "node:zlib";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, type PublicClient } from "viem";
import type { Pool } from "pg";

export type CoverageIdentity = {
  address: string; name: string; symbol: string; decimals: number; totalSupply: string;
};

export function identityCoverageFixture(identities: readonly CoverageIdentity[], poolCount: number) {
  const values = new Map(identities.map((identity) => [identity.address.toLowerCase(), identity]));
  const shards = new Map<number, Buffer>();
  let catalog: Record<string, unknown>[] = [];
  let failWrite = false;
  const connections = () => ({
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith("SELECT shard,payload")) {
        return { rows: [...shards].map(([shard, payload]) => ({ shard, payload })) };
      }
      if (sql.startsWith("SELECT total_canonical_markets")) return { rows: catalog };
      if (sql.includes("COUNT(*)::text AS count")) return { rows: [{ count: String(poolCount) }] };
      if (sql.includes("encode(token0,'hex') AS token0")) {
        const tokens = [...values.keys()].sort();
        return { rows: tokens.map((token, index) => ({ token0: token.slice(2), token1: token.slice(2),
          block_number: tokens.length - index, log_index: 0 }))
          .filter((row) => row.block_number < Number(args[0]) || (row.block_number === Number(args[0]) && row.log_index < Number(args[1])))
          .slice(0, 4096) };
      }
      if (sql.startsWith("INSERT INTO market_token_identity_shard")) {
        if (failWrite) throw new Error("TEST_STORAGE_WRITE_UNAVAILABLE");
        shards.set(args[0] as number, Buffer.from(args[1] as Buffer));
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO market_token_identity_catalog_state")) {
        catalog = [{ total_canonical_markets: args[0], total_unique_tokens: args[1],
          evaluated_tokens: args[2], verified_tokens: args[3], complete: args[4] }];
        return { rows: [] };
      }
      throw new Error("UNEXPECTED_IDENTITY_STORAGE_QUERY");
    }
  }) as unknown as Pool;
  let mode: "healthy" | "aggregate_failure" | "read_failure" | "malformed" | "truncated" = "healthy";
  let calls = 0;
  let maximumContracts = 0;
  const field = (address: string, name: string): unknown => {
    const identity = values.get(address.toLowerCase());
    if (!identity) throw new Error("UNEXPECTED_IDENTITY_ADDRESS");
    if (name === "totalSupply") return BigInt(identity.totalSupply);
    if (name === "decimals" && mode === "malformed") return 0.5;
    return identity[name as keyof CoverageIdentity];
  };
  const failure = () => Object.assign(new Error("aggregate call execution failed"), {
    name: "ContractFunctionExecutionError"
  });
  const rpc = {
    multicall: async ({ contracts, blockNumber }: {
      contracts: { address: string; functionName: string }[]; blockNumber: bigint;
    }) => {
      calls += 1;
      maximumContracts = Math.max(maximumContracts, contracts.length);
      if (blockNumber !== 100n) throw new Error("UNPINNED_IDENTITY_READ");
      if (mode === "truncated") return [];
      return contracts.map((contract) => mode === "read_failure" || mode === "aggregate_failure"
        ? { status: "failure", error: failure() }
        : { status: "success", result: field(contract.address, contract.functionName) });
    },
    call: async ({ to, data, blockNumber, gas }: {
      to: string; data: `0x${string}`; blockNumber: bigint; gas: bigint;
    }) => {
      calls += 1;
      if (blockNumber !== 100n || gas !== 100_000n) throw new Error("UNBOUNDED_IDENTITY_READ");
      if (mode === "read_failure") throw failure();
      const decoded = decodeFunctionData({ abi: erc20Abi, data });
      return { data: encodeFunctionResult({ abi: erc20Abi, functionName: decoded.functionName,
        result: field(to, decoded.functionName) as never }) };
    }
  } as unknown as PublicClient;
  const entries = () => [...shards.values()].flatMap((payload) =>
    JSON.parse(gunzipSync(payload).toString("utf8")) as unknown[][]);
  const seed = (readyAddresses: readonly string[], negativeAddresses: readonly string[] = []) => {
    const grouped = new Map<number, unknown[][]>();
    for (const address of [...new Set([...readyAddresses, ...negativeAddresses])]) {
      const key = address.toLowerCase();
      const identity = values.get(key)!;
      const shard = Number.parseInt(key.slice(2, 4), 16);
      const group = grouped.get(shard) ?? [];
      group.push(readyAddresses.includes(address)
        ? [key.slice(2), "r", identity.name, identity.symbol, identity.decimals]
        : [key.slice(2), "i"]);
      grouped.set(shard, group);
    }
    for (const [shard, group] of grouped) shards.set(shard, gzipSync(JSON.stringify(group)));
  };
  return { pool: connections, rpc, entries, seed, addresses: [...values.keys()].sort(),
    setMode: (next: typeof mode) => { mode = next; },
    setWriteFailure: (next: boolean) => { failWrite = next; },
    get calls() { return calls; }, get maximumContracts() { return maximumContracts; } };
}
