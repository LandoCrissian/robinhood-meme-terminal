import { createPublicClient, getAddress, http, isAddress, parseEther, type Address } from "viem";
import {
  getFactoryAddress,
  publicMainnetFactoryAddress,
  publicMainnetVersionRegistryAddress,
  versionRegistryAbi
} from "../contracts";
import { activeChain, activeNetworkLabel, isMainnetRelease } from "../network";
import type { SystemHealthCheck, SystemHealthReport } from "../system-health";

const factoryHealthAbi = [
  { type: "function", name: "launchCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marketFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "graduationTarget", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduationAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const adapterHealthAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const client = createPublicClient({
  chain: activeChain,
  transport: http(activeChain.rpcUrls.default.http[0], { retryCount: 2, timeout: 8_000 })
});

function check(key: SystemHealthCheck["key"], label: string, healthy: boolean, detail: string): SystemHealthCheck {
  return { key, label, state: healthy ? "operational" : "degraded", detail };
}

export async function readSystemHealth(): Promise<SystemHealthReport> {
  const checkedAt = new Date().toISOString();
  const checks: SystemHealthCheck[] = [];

  try {
    const [chainId, latestBlock] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    checks.push(check("rpc", "Robinhood Chain connection", chainId === activeChain.id, `Block ${latestBlock.toString()} · Chain ${chainId}`));

    let factory: Address | null = getFactoryAddress();
    if (isMainnetRelease) {
      const registered = await client.readContract({
        address: publicMainnetVersionRegistryAddress,
        abi: versionRegistryAbi,
        functionName: "activeFactory"
      });
      factory = isAddress(registered) ? getAddress(registered) : null;
      checks.push(check(
        "registry",
        "Version registry",
        factory === publicMainnetFactoryAddress,
        factory ? `Active factory ${factory.slice(0, 8)}…${factory.slice(-6)}` : "No active factory returned"
      ));
    } else {
      checks.push(check("registry", "Factory selection", Boolean(factory), factory ? "Verified testnet factory selected" : "Factory unavailable"));
    }

    if (!factory) throw new Error("Active factory is unavailable.");

    const [bytecode, launchCount, feeBps, graduationTarget, adapter] = await Promise.all([
      client.getBytecode({ address: factory }),
      client.readContract({ address: factory, abi: factoryHealthAbi, functionName: "launchCount" }),
      client.readContract({ address: factory, abi: factoryHealthAbi, functionName: "marketFeeBps" }),
      client.readContract({ address: factory, abi: factoryHealthAbi, functionName: "graduationTarget" }),
      client.readContract({ address: factory, abi: factoryHealthAbi, functionName: "graduationAdapter" })
    ]);

    checks.push(check(
      "factory",
      "Launch factory",
      Boolean(bytecode && bytecode !== "0x"),
      `${launchCount.toString()} verified launch${launchCount === 1n ? "" : "es"} recorded`
    ));

    const expectedEconomics = isMainnetRelease
      ? feeBps === 100 && graduationTarget === parseEther("1")
      : feeBps < 10_000 && graduationTarget > 0n;
    checks.push(check(
      "economics",
      "Immutable launch economics",
      expectedEconomics,
      `${Number(feeBps) / 100}% market fee · ${Number(graduationTarget) / 1e18} ETH graduation target`
    ));

    const boundFactory = await client.readContract({
      address: adapter,
      abi: adapterHealthAbi,
      functionName: "factory"
    });
    checks.push(check(
      "graduation",
      "Graduation adapter",
      getAddress(boundFactory) === factory,
      `Bound to active factory · ${adapter.slice(0, 8)}…${adapter.slice(-6)}`
    ));

    return {
      ok: checks.every((item) => item.state === "operational"),
      network: activeNetworkLabel,
      chainId,
      latestBlock: latestBlock.toString(),
      checkedAt,
      checks
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Onchain verification failed.";
    const seen = new Set(checks.map((item) => item.key));
    const remaining: Array<[SystemHealthCheck["key"], string]> = [
      ["rpc", "Robinhood Chain connection"],
      ["registry", "Version registry"],
      ["factory", "Launch factory"],
      ["economics", "Immutable launch economics"],
      ["graduation", "Graduation adapter"]
    ];
    for (const [key, label] of remaining) {
      if (!seen.has(key)) checks.push(check(key, label, false, detail));
    }
    return {
      ok: false,
      network: activeNetworkLabel,
      chainId: activeChain.id,
      latestBlock: "unavailable",
      checkedAt,
      checks
    };
  }
}
