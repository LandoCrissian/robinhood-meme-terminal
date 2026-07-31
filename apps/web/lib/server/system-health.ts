import { createPublicClient, getAddress, http, isAddress, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { unstable_cache } from "next/cache";
import {
  getFactoryAddress,
  isFreshMainnetVersionRegistryConfigured,
  isMainnetVersionRegistryConfigurationValid,
  isMainnetVersionRegistryExplicitlyConfigured,
  publicMainnetOperatorAddress,
  publicMainnetV6FactoryAddress,
  publicMainnetVersionRegistryAddress,
  rmtLaunchFactoryV6Abi,
  versionRegistryAbi
} from "../contracts";
import {
  activeChain,
  activeFactoryStartBlock,
  activeNetworkLabel,
  isFactoryStartBlockConfigurationValid,
  isFactoryStartBlockExplicitlyConfigured,
  isMainnetRelease
} from "../network";
import type { SystemHealthCheck, SystemHealthReleaseEvidence, SystemHealthReport } from "../system-health";

const factoryHealthAbi = [
  { type: "function", name: "launchCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marketFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "graduationTarget", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduationAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const adapterHealthAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const marketHealthAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "graduationTarget", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduationAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }
] as const;

const governanceHealthAbi = [
  { type: "function", name: "executionDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "executionWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "configurationEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "signerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isSigner", stateMutability: "view", inputs: [{ name: "signer", type: "address" }], outputs: [{ type: "bool" }] }
] as const;

const client = createPublicClient({
  chain: activeChain,
  transport: http(
    isMainnetRelease
      ? process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? activeChain.rpcUrls.default.http[0]
      : process.env.RMT_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_TESTNET_RPC_URL ?? activeChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});
const V6_VERSION = keccak256(toHex("RMT_FACTORY_V6"));
const FAIR_POLICY_ID = keccak256(toHex("RMT_SIMPLE_FAIR_V1"));

function check(key: SystemHealthCheck["key"], label: string, healthy: boolean, detail: string): SystemHealthCheck {
  return { key, label, state: healthy ? "operational" : "degraded", detail };
}

function publicHealthError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("too long")) {
    return "Live verification timed out. RMT will check again automatically.";
  }
  if (message.includes("active factory is unavailable")) {
    return "The active launch factory could not be verified. RMT will check again automatically.";
  }
  return "Live onchain verification could not finish. RMT will check again automatically.";
}

export async function readFreshSystemHealth(): Promise<SystemHealthReport> {
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  const checks: SystemHealthCheck[] = [];
  let blockAgeSeconds: number | null = null;
  let observedChainId: number = activeChain.id;
  let observedLatestBlock: bigint | null = null;
  let factory: Address | null = getFactoryAddress();
  let factoryVersion: Hex | null = null;
  const releaseEvidence = (): SystemHealthReleaseEvidence => ({
    mode: isMainnetRelease
      ? factoryVersion === V6_VERSION
        && isFreshMainnetVersionRegistryConfigured
        && isFactoryStartBlockExplicitlyConfigured
        && isFactoryStartBlockConfigurationValid
          ? "v6-cutover"
          : "configuration-error"
      : "testnet",
    registryAddress: isMainnetRelease ? publicMainnetVersionRegistryAddress : null,
    factoryAddress: factory,
    factoryVersion,
    factoryStartBlock: activeFactoryStartBlock.toString(),
    registryConfiguredExplicitly: isMainnetRelease && isMainnetVersionRegistryExplicitlyConfigured,
    registryConfigurationValid: !isMainnetRelease || isMainnetVersionRegistryConfigurationValid,
    factoryStartBlockConfiguredExplicitly: isFactoryStartBlockExplicitlyConfigured,
    factoryStartBlockConfigurationValid: isFactoryStartBlockConfigurationValid
  });

  try {
    const [chainId, latestBlock] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    observedChainId = chainId;
    observedLatestBlock = latestBlock;
    const block = await client.getBlock({ blockNumber: latestBlock });
    blockAgeSeconds = Math.max(0, Math.floor(Date.now() / 1_000 - Number(block.timestamp)));
    checks.push(check(
      "rpc",
      "Robinhood Chain connection",
      chainId === activeChain.id && blockAgeSeconds <= 60,
      `Block ${latestBlock.toString()} · ${blockAgeSeconds}s old · Chain ${chainId}`
    ));

    if (isMainnetRelease) {
      const [registryCode, registered, registeredVersion] = await Promise.all([
        client.getBytecode({ address: publicMainnetVersionRegistryAddress }),
        client.readContract({
          address: publicMainnetVersionRegistryAddress,
          abi: versionRegistryAbi,
          functionName: "activeFactory"
        }),
        client.readContract({
          address: publicMainnetVersionRegistryAddress,
          abi: versionRegistryAbi,
          functionName: "activeVersion"
        })
      ]);
      factory = isAddress(registered) ? getAddress(registered) : null;
      factoryVersion = registeredVersion;
      const isV6 = factoryVersion === V6_VERSION && factory === publicMainnetV6FactoryAddress;
      const v6CutoverConfigured = isFreshMainnetVersionRegistryConfigured
        && isFactoryStartBlockExplicitlyConfigured
        && isFactoryStartBlockConfigurationValid;
      const registryHealthy = Boolean(registryCode && registryCode !== "0x")
        && isMainnetVersionRegistryConfigurationValid
        && isFactoryStartBlockConfigurationValid
        && activeFactoryStartBlock <= latestBlock
        && isV6
        && v6CutoverConfigured;
      checks.push(check(
        "registry",
        "Version registry",
        registryHealthy,
        factory
          ? `Registry ${publicMainnetVersionRegistryAddress} · factory ${factory} · version ${factoryVersion} · scan start ${activeFactoryStartBlock.toString()}`
          : `Registry ${publicMainnetVersionRegistryAddress} returned no active factory`
      ));
      if (!registryHealthy) factory = null;
    } else {
      checks.push(check("registry", "Factory selection", Boolean(factory), factory ? "Verified testnet factory selected" : "Factory unavailable"));
    }

    if (!factory) throw new Error("Active factory is unavailable.");

    if (factoryVersion === V6_VERSION) {
      const [bytecode, protocolVersion, launchCount, launchesPaused, defaultPolicyId, payoutAuthority] = await Promise.all([
        client.getBytecode({ address: factory }),
        client.readContract({ address: factory, abi: rmtLaunchFactoryV6Abi, functionName: "protocolVersion" }),
        client.readContract({ address: factory, abi: factoryHealthAbi, functionName: "launchCount" }),
        client.readContract({ address: factory, abi: rmtLaunchFactoryV6Abi, functionName: "launchesPaused" }),
        client.readContract({ address: factory, abi: rmtLaunchFactoryV6Abi, functionName: "defaultPolicyId" }),
        client.readContract({ address: factory, abi: rmtLaunchFactoryV6Abi, functionName: "creatorPayoutAuthority" })
      ]);
      const [
        governanceCode,
        governanceDelay,
        governanceWindow,
        governanceEpoch,
        governanceThreshold,
        governanceSignerCount,
        operatorIsSigner
      ] = await Promise.all([
        client.getBytecode({ address: payoutAuthority }),
        client.readContract({ address: payoutAuthority, abi: governanceHealthAbi, functionName: "executionDelay" }),
        client.readContract({ address: payoutAuthority, abi: governanceHealthAbi, functionName: "executionWindow" }),
        client.readContract({ address: payoutAuthority, abi: governanceHealthAbi, functionName: "configurationEpoch" }),
        client.readContract({ address: payoutAuthority, abi: governanceHealthAbi, functionName: "threshold" }),
        client.readContract({ address: payoutAuthority, abi: governanceHealthAbi, functionName: "signerCount" }),
        client.readContract({ address: payoutAuthority, abi: governanceHealthAbi, functionName: "isSigner", args: [publicMainnetOperatorAddress] })
      ]);
      const policy = await client.readContract({
        address: factory,
        abi: rmtLaunchFactoryV6Abi,
        functionName: "getPolicy",
        args: [defaultPolicyId]
      });
      const payoutControlHealthy = Boolean(governanceCode && governanceCode !== "0x")
        && governanceDelay === 86_400n
        && governanceWindow === 604_800n
        && governanceEpoch > 0n
        && governanceThreshold > 0n
        && governanceThreshold <= governanceSignerCount
        && (governanceSignerCount === 1n || governanceThreshold > 1n)
        && operatorIsSigner;
      const payoutControlDetail = payoutControlHealthy
        ? `creator payouts ${governanceThreshold.toString()}-of-${governanceSignerCount.toString()} delayed governance`
        : `creator-payout authority mismatch or governance verification failed (${payoutAuthority.slice(0, 8)}…${payoutAuthority.slice(-6)})`;
      checks.push(check(
        "factory",
        "V6 launch factory",
        Boolean(bytecode && bytecode !== "0x") && protocolVersion === 6 && payoutControlHealthy,
        `${launchCount.toString()} V6 launch${launchCount === 1n ? "" : "es"} · launches ${launchesPaused ? "paused safely" : "open"} · ${payoutControlDetail}`
      ));
      const expectedEconomics = defaultPolicyId === FAIR_POLICY_ID
        && policy.policyId === FAIR_POLICY_ID && policy.policyVersion === 1
        && policy.enabled && policy.publiclySelectable
        && policy.curveFeeBps === 100 && policy.creatorFeeShareBps === 7_000
        && policy.protocolFeeShareBps === 3_000 && policy.postGraduationFeeBps === 50
        && policy.graduationTarget === parseEther("2")
        && policy.fairStartMode === 1 && policy.fairStartDelayBlocks === 1n
        && policy.fairStartDurationBlocks === 10n && policy.fairStartMaxTxBps === 100
        && policy.fairStartMaxWalletBps === 300;
      checks.push(check(
        "economics",
        "Immutable V6 launch economics",
        expectedEconomics,
        `${Number(policy.curveFeeBps) / 100}% curve fee · 70/30 creator-share/RMT split · ${formatEth(policy.graduationTarget)} ETH graduation`
      ));

      let latestMarketHealthy = launchCount === 0n;
      let latestMarketDetail = "No V6 launches yet; factory is ready for the first market.";
      let latestGraduationAdapter: Address | null = null;
      if (launchCount > 0n) {
        const latestLaunchId = launchCount - 1n;
        const latestLaunch = await client.readContract({
          address: factory,
          abi: rmtLaunchFactoryV6Abi,
          functionName: "getLaunch",
          args: [latestLaunchId]
        });
        const [marketCode, tokenCode, marketToken, marketTarget, marketAdapter, marketGraduated] = await Promise.all([
          client.getBytecode({ address: latestLaunch.market }),
          client.getBytecode({ address: latestLaunch.token }),
          client.readContract({ address: latestLaunch.market, abi: marketHealthAbi, functionName: "token" }),
          client.readContract({ address: latestLaunch.market, abi: marketHealthAbi, functionName: "graduationTarget" }),
          client.readContract({ address: latestLaunch.market, abi: marketHealthAbi, functionName: "graduationAdapter" }),
          client.readContract({ address: latestLaunch.market, abi: marketHealthAbi, functionName: "graduated" })
        ]);
        latestGraduationAdapter = getAddress(marketAdapter);
        latestMarketHealthy = Boolean(marketCode && marketCode !== "0x" && tokenCode && tokenCode !== "0x")
          && getAddress(marketToken) === getAddress(latestLaunch.token)
          && marketTarget === policy.graduationTarget;
        latestMarketDetail = `Launch #${latestLaunchId.toString()} · ${marketGraduated ? "curve complete" : "curve trading"} · market ${latestLaunch.market.slice(0, 8)}…${latestLaunch.market.slice(-6)}`;
      }
      checks.push(check(
        "trading",
        "Latest V6 market",
        latestMarketHealthy,
        latestMarketDetail
      ));

      let graduationHealthy = expectedEconomics && latestGraduationAdapter !== null;
      let graduationDetail = "No live V6 market is available to verify the graduation adapter.";
      if (latestGraduationAdapter) {
        const [adapterCode, boundFactory] = await Promise.all([
          client.getBytecode({ address: latestGraduationAdapter }),
          client.readContract({ address: latestGraduationAdapter, abi: adapterHealthAbi, functionName: "factory" })
        ]);
        graduationHealthy = graduationHealthy
          && Boolean(adapterCode && adapterCode !== "0x")
          && getAddress(boundFactory) === factory;
        graduationDetail = `${Number(policy.postGraduationFeeBps) / 100}% Uniswap v4 pool fee · latest market adapter bound to active factory · ${latestGraduationAdapter.slice(0, 8)}…${latestGraduationAdapter.slice(-6)}`;
      }
      checks.push(check(
        "graduation",
        "Uniswap v4 graduation route",
        graduationHealthy,
        graduationDetail
      ));
      return {
        ok: checks.every((item) => item.state === "operational"),
        network: activeNetworkLabel,
        chainId,
        latestBlock: latestBlock.toString(),
        blockAgeSeconds,
        latencyMs: Date.now() - startedAt,
        checkedAt,
        releaseEvidence: releaseEvidence(),
        checks
      };
    }

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

    const expectedGraduationTarget = parseEther("1");
    const expectedEconomics = isMainnetRelease
      ? feeBps === 100 && graduationTarget === expectedGraduationTarget
      : feeBps < 10_000 && graduationTarget > 0n;
    checks.push(check(
      "economics",
      "Immutable launch economics",
      expectedEconomics,
      `${Number(feeBps) / 100}% market fee · ${Number(graduationTarget) / 1e18} ETH graduation target`
    ));

    const [adapterCode, boundFactory] = await Promise.all([
      client.getBytecode({ address: adapter }),
      client.readContract({ address: adapter, abi: adapterHealthAbi, functionName: "factory" })
    ]);
    checks.push(check(
      "graduation",
      "Graduation adapter",
      Boolean(adapterCode && adapterCode !== "0x") && getAddress(boundFactory) === factory,
      `Bound to active factory · ${adapter.slice(0, 8)}…${adapter.slice(-6)}`
    ));

    return {
      ok: checks.every((item) => item.state === "operational"),
      network: activeNetworkLabel,
      chainId,
      latestBlock: latestBlock.toString(),
      blockAgeSeconds,
      latencyMs: Date.now() - startedAt,
      checkedAt,
      releaseEvidence: releaseEvidence(),
      checks
    };
  } catch (error) {
    const detail = publicHealthError(error);
    const seen = new Set(checks.map((item) => item.key));
    const remaining: Array<[SystemHealthCheck["key"], string]> = [
      ["rpc", "Robinhood Chain connection"],
      ["registry", "Version registry"],
      ["factory", "Launch factory"],
      ["economics", "Immutable launch economics"],
      ["trading", "Latest market"],
      ["graduation", "Graduation adapter"]
    ];
    for (const [key, label] of remaining) {
      if (!seen.has(key)) checks.push(check(key, label, false, detail));
    }
    return {
      ok: false,
      network: activeNetworkLabel,
      chainId: observedChainId,
      latestBlock: observedLatestBlock?.toString() ?? "unavailable",
      blockAgeSeconds,
      latencyMs: Date.now() - startedAt,
      checkedAt,
      releaseEvidence: releaseEvidence(),
      checks
    };
  }
}

const readSystemHealthCached = unstable_cache(
  readFreshSystemHealth,
  ["rmt-v6-system-health"],
  { revalidate: 15 }
);

export async function readSystemHealth(): Promise<SystemHealthReport> {
  return readSystemHealthCached();
}

function formatEth(value: bigint) {
  return Number(value) / 1e18;
}
