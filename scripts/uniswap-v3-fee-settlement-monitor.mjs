#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

export const FEE_MONITOR_CONSTANTS = Object.freeze({
  chainId: 4_663,
  productionOrigin: "https://www.rmtlaunch.fun",
  publicRpcUrl: "https://rpc.mainnet.chain.robinhood.com/",
  publicReleaseBlock: 37_805_030n,
  publicReleaseBlockHash: "0xdfb2560bb21f75c08e2ddaeac71075fb71523f45a543149018891c5fa673b9b2",
  publicReleaseTimestamp: "2026-08-16T07:42:40.000Z",
  confirmations: 64n,
  logChunkSize: 2_000n,
  executor: "0xcb9c00524848038d211921e0f3975190d7aa1e8f",
  executorRuntimeHash: "0xc6d54277c89993410fa71ad24c7a6cea0072a4f0f20a8759a04d9e4a4c37813d",
  router: "0xcaf681a66d020601342297493863e78c959e5cb2",
  treasury: "0x61700479a4a1f62584fd3aba2c2b290ea727d2ec",
  policyIdHash: "0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb",
  policyHash: "0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141",
  providerId: "0xf0053fdd2d810156fac49867b1b7098650da64e62c727083a69932e7378a07a7",
  feeBps: 25,
  eventTopic: "0xb5b9019547037bceeeebe2789d6d37098104b30017e12d2f12be47c13a0bdab5",
  usdg: Object.freeze({
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    symbol: "USDG",
    decimals: 6
  }),
  weth: Object.freeze({
    address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    symbol: "WETH",
    decimals: 18
  })
});

export const READ_ONLY_RPC_METHODS = Object.freeze([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "web3_sha3"
]);

const READ_ONLY_RPC_METHOD_SET = new Set(READ_ONLY_RPC_METHODS);
const HASH_PATTERN = /^0x[0-9a-f]{64}$/u;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/u;
const HEX_PATTERN = /^0x[0-9a-f]*$/u;
const WORD_HEX_LENGTH = 64;
const SETTLEMENT_DATA_WORDS = 14;
const BALANCE_OF_SELECTOR = "70a08231";
const ALLOWANCE_SELECTOR = "dd62ed3e";

function invariant(condition, message) {
  if (!condition) throw new Error(`RMT fee monitor rejected invalid evidence: ${message}.`);
}

function normalizedHex(value, pattern, label) {
  invariant(typeof value === "string", `${label} is not a string`);
  const normalized = value.toLowerCase();
  invariant(pattern.test(normalized), `${label} is malformed`);
  return normalized;
}

function address(value, label) {
  return normalizedHex(value, ADDRESS_PATTERN, label);
}

function hash(value, label) {
  return normalizedHex(value, HASH_PATTERN, label);
}

function quantity(value, label) {
  invariant(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value), `${label} is not a canonical quantity`);
  return BigInt(value);
}

function toQuantity(value) {
  invariant(typeof value === "bigint" && value >= 0n, "quantity input is invalid");
  return `0x${value.toString(16)}`;
}

function wordAddress(word, label) {
  invariant(typeof word === "string" && /^[0-9a-f]{64}$/u.test(word), `${label} word is malformed`);
  invariant(word.slice(0, 24) === "0".repeat(24), `${label} padding is noncanonical`);
  return address(`0x${word.slice(24)}`, label);
}

function wordUint(word, label) {
  invariant(typeof word === "string" && /^[0-9a-f]{64}$/u.test(word), `${label} word is malformed`);
  return BigInt(`0x${word}`);
}

function calldataAddress(value) {
  return address(value, "calldata address").slice(2).padStart(64, "0");
}

function balanceOfCalldata(owner) {
  return `0x${BALANCE_OF_SELECTOR}${calldataAddress(owner)}`;
}

function allowanceCalldata(owner, spender) {
  return `0x${ALLOWANCE_SELECTOR}${calldataAddress(owner)}${calldataAddress(spender)}`;
}

function atomicDisplay(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function assertHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`RMT fee monitor rejected invalid evidence: ${label} is not a URL.`);
  }
  invariant(parsed.protocol === "https:", `${label} must use HTTPS`);
  invariant(!parsed.username && !parsed.password, `${label} must not contain embedded credentials`);
  return parsed.toString().replace(/\/$/u, "");
}

export function validateProductionReadiness(input) {
  invariant(input && typeof input === "object" && !Array.isArray(input), "readiness response is malformed");
  invariant(input.mode === "interactive", "production is not interactive");
  invariant(input.shellEnabled === true, "production shell is disabled");
  invariant(input.configurationConsistent === true, "production configuration is inconsistent");
  invariant(input.execution?.authorizationClientEnabled === true, "client authorization is disabled");
  invariant(input.execution?.authorizationServerEnabled === true, "server authorization is disabled");
  invariant(input.execution?.walletSubmissionEnabled === true, "wallet submission is disabled");
  const provider = input.providers?.uniswapV3FeeExecutor;
  invariant(provider && typeof provider === "object", "fee-executor readiness is missing");
  invariant(provider.policyEnabled === true, "fee policy is disabled");
  invariant(provider.configured === true, "fee executor is not configured");
  invariant(provider.releaseScope === "public", "fee release is not public");
  invariant(provider.strictVerificationAvailable === true, "strict verification is unavailable");
  invariant(provider.walletAuthorizationAvailable === true, "wallet authorization is unavailable");
  invariant(provider.authorizationEnabled === true, "fee authorization is disabled");
  invariant(provider.publicAuthorizationEnabled === true, "public fee authorization is disabled");
  invariant(provider.publicProofBindingValid === true, "public proof binding is invalid");
  invariant(provider.deployedAndVerified === true, "fee executor is not deployment-verified");
  invariant(provider.mainnetProofComplete === true, "mainnet proof is incomplete");
  return {
    mode: input.mode,
    shellEnabled: input.shellEnabled,
    configurationConsistent: input.configurationConsistent,
    authorizationClientEnabled: input.execution.authorizationClientEnabled,
    authorizationServerEnabled: input.execution.authorizationServerEnabled,
    walletSubmissionEnabled: input.execution.walletSubmissionEnabled,
    releaseScope: provider.releaseScope,
    policyEnabled: provider.policyEnabled,
    authorizationEnabled: provider.authorizationEnabled,
    publicAuthorizationEnabled: provider.publicAuthorizationEnabled,
    publicProofBindingValid: provider.publicProofBindingValid,
    deployedAndVerified: provider.deployedAndVerified,
    mainnetProofComplete: provider.mainnetProofComplete
  };
}

export function decodeSettlementLog(log) {
  invariant(log && typeof log === "object" && !Array.isArray(log), "settlement log is malformed");
  invariant(address(log.address, "log emitter") === FEE_MONITOR_CONSTANTS.executor, "settlement emitter changed");
  invariant(log.removed !== true, "settlement log was removed");
  invariant(Array.isArray(log.topics) && log.topics.length === 4, "settlement topics are malformed");
  const topics = log.topics.map((topic, index) => hash(topic, `topic ${index}`));
  invariant(topics[0] === FEE_MONITOR_CONSTANTS.eventTopic, "settlement event topic changed");
  const executionId = topics[1];
  const policyHash = topics[2];
  const trader = wordAddress(topics[3].slice(2), "trader");
  invariant(policyHash === FEE_MONITOR_CONSTANTS.policyHash, "settlement policy hash changed");
  const data = normalizedHex(log.data, HEX_PATTERN, "settlement data").slice(2);
  invariant(data.length === SETTLEMENT_DATA_WORDS * WORD_HEX_LENGTH, "settlement data length changed");
  const words = Array.from({ length: SETTLEMENT_DATA_WORDS }, (_, index) => (
    data.slice(index * WORD_HEX_LENGTH, (index + 1) * WORD_HEX_LENGTH)
  ));
  const policyIdHash = hash(`0x${words[0]}`, "policy ID hash");
  const policyVersion = wordUint(words[1], "policy version");
  const providerId = hash(`0x${words[2]}`, "provider ID");
  const router = wordAddress(words[3], "router");
  const routeIdentity = hash(`0x${words[4]}`, "route identity");
  const feeAsset = wordAddress(words[5], "fee asset");
  const feeBps = wordUint(words[6], "fee bps");
  const feeSide = wordUint(words[7], "fee side");
  const userGrossInput = wordUint(words[8], "gross input");
  const providerInput = wordUint(words[9], "provider input");
  const grossActualOutput = wordUint(words[10], "gross output");
  const actualRmtFee = wordUint(words[11], "actual fee");
  const actualUserNetOutput = wordUint(words[12], "net output");
  const treasury = wordAddress(words[13], "treasury");
  invariant(policyIdHash === FEE_MONITOR_CONSTANTS.policyIdHash, "policy ID changed");
  invariant(policyVersion === 1n, "policy version changed");
  invariant(providerId === FEE_MONITOR_CONSTANTS.providerId, "provider ID changed");
  invariant(router === FEE_MONITOR_CONSTANTS.router, "router changed");
  invariant(feeBps === BigInt(FEE_MONITOR_CONSTANTS.feeBps), "fee bps changed");
  invariant(feeSide === 0n || feeSide === 1n, "fee side is invalid");
  invariant(treasury === FEE_MONITOR_CONSTANTS.treasury, "treasury changed");
  invariant(
    feeAsset === FEE_MONITOR_CONSTANTS.usdg.address || feeAsset === FEE_MONITOR_CONSTANTS.weth.address,
    "fee asset is not eligible"
  );
  invariant(userGrossInput > 0n && providerInput > 0n && grossActualOutput > 0n && actualUserNetOutput > 0n,
    "settlement amounts are not positive");
  if (feeSide === 0n) {
    const expectedFee = userGrossInput * BigInt(FEE_MONITOR_CONSTANTS.feeBps) / 10_000n;
    invariant(actualRmtFee === expectedFee, "input-side fee math changed");
    invariant(providerInput + actualRmtFee === userGrossInput, "input-side provider amount changed");
    invariant(actualUserNetOutput === grossActualOutput, "input-side net output changed");
  } else {
    const maximumCandidate = grossActualOutput * BigInt(FEE_MONITOR_CONSTANTS.feeBps) / 10_000n;
    invariant(actualRmtFee <= maximumCandidate, "output-side fee exceeds policy math");
    invariant(actualUserNetOutput + actualRmtFee === grossActualOutput, "output-side net output changed");
  }
  return {
    executionId,
    policyHash,
    trader,
    policyIdHash,
    policyVersion: Number(policyVersion),
    providerId,
    router,
    routeIdentity,
    feeAsset,
    feeBps: Number(feeBps),
    feeSide: feeSide === 0n ? "input" : "output",
    userGrossInput,
    providerInput,
    grossActualOutput,
    actualRmtFee,
    actualUserNetOutput,
    treasury,
    transactionHash: hash(log.transactionHash, "transaction hash"),
    blockHash: hash(log.blockHash, "block hash"),
    blockNumber: quantity(log.blockNumber, "log block number"),
    logIndex: quantity(log.logIndex, "log index")
  };
}

export function createRpcReader(rpcUrl, fetcher = globalThis.fetch) {
  assertHttpsUrl(rpcUrl, "RPC URL");
  invariant(typeof fetcher === "function", "fetch implementation is unavailable");
  let id = 0;
  return async (method, params = []) => {
    invariant(READ_ONLY_RPC_METHOD_SET.has(method), `RPC method ${method} is not read-only allowlisted`);
    const response = await fetcher(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(15_000)
    });
    invariant(response?.ok === true, `RPC ${method} returned HTTP ${response?.status ?? "unknown"}`);
    const envelope = await response.json();
    invariant(envelope && typeof envelope === "object" && !Array.isArray(envelope), `RPC ${method} response is malformed`);
    invariant(envelope.error === undefined, `RPC ${method} returned an error`);
    invariant(envelope.result !== undefined, `RPC ${method} result is missing`);
    return envelope.result;
  };
}

async function readContractUint(rpc, to, data, label) {
  const result = await rpc("eth_call", [{ to, data }, "latest"]);
  invariant(typeof result === "string" && /^0x[0-9a-f]{64}$/iu.test(result), `${label} result is malformed`);
  return BigInt(result);
}

async function settlementLogs(rpc, fromBlock, toBlock) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += FEE_MONITOR_CONSTANTS.logChunkSize) {
    const end = start + FEE_MONITOR_CONSTANTS.logChunkSize - 1n > toBlock
      ? toBlock
      : start + FEE_MONITOR_CONSTANTS.logChunkSize - 1n;
    const chunk = await rpc("eth_getLogs", [{
      address: FEE_MONITOR_CONSTANTS.executor,
      topics: [FEE_MONITOR_CONSTANTS.eventTopic],
      fromBlock: toQuantity(start),
      toBlock: toQuantity(end)
    }]);
    invariant(Array.isArray(chunk), "settlement log response is not an array");
    logs.push(...chunk);
  }
  return logs;
}

function feeAssetSummary(asset, atomic) {
  return {
    address: asset.address,
    symbol: asset.symbol,
    decimals: asset.decimals,
    atomic: atomic.toString(),
    display: atomicDisplay(atomic, asset.decimals)
  };
}

export async function inspectPublicFeeSettlements({ rpc, readiness, checkedAt = new Date().toISOString() }) {
  invariant(typeof rpc === "function", "RPC reader is missing");
  const readinessSummary = validateProductionReadiness(readiness);
  const chainId = quantity(await rpc("eth_chainId"), "chain ID");
  invariant(chainId === BigInt(FEE_MONITOR_CONSTANTS.chainId), "RPC chain changed");
  const headBlock = quantity(await rpc("eth_blockNumber"), "head block");
  invariant(headBlock >= FEE_MONITOR_CONSTANTS.publicReleaseBlock + FEE_MONITOR_CONSTANTS.confirmations,
    "chain head is before the confirmed public release boundary");
  const confirmedToBlock = headBlock - FEE_MONITOR_CONSTANTS.confirmations;
  const releaseBlock = await rpc("eth_getBlockByNumber", [toQuantity(FEE_MONITOR_CONSTANTS.publicReleaseBlock), false]);
  invariant(releaseBlock && typeof releaseBlock === "object" && !Array.isArray(releaseBlock), "release block is unavailable");
  invariant(quantity(releaseBlock.number, "release block number") === FEE_MONITOR_CONSTANTS.publicReleaseBlock,
    "release block number changed");
  invariant(hash(releaseBlock.hash, "release block hash") === FEE_MONITOR_CONSTANTS.publicReleaseBlockHash,
    "release block hash changed");
  const releaseTimestamp = new Date(Number(quantity(releaseBlock.timestamp, "release timestamp")) * 1_000).toISOString();
  invariant(releaseTimestamp === FEE_MONITOR_CONSTANTS.publicReleaseTimestamp, "release timestamp changed");
  const runtime = normalizedHex(await rpc("eth_getCode", [FEE_MONITOR_CONSTANTS.executor, "latest"]), HEX_PATTERN, "executor runtime");
  invariant(runtime !== "0x", "executor runtime is missing");
  const runtimeHash = hash(await rpc("web3_sha3", [runtime]), "executor runtime hash");
  invariant(runtimeHash === FEE_MONITOR_CONSTANTS.executorRuntimeHash, "executor runtime hash changed");

  const rawLogs = await settlementLogs(rpc, FEE_MONITOR_CONSTANTS.publicReleaseBlock, confirmedToBlock);
  const settlements = rawLogs.map(decodeSettlementLog).sort((left, right) => (
    left.blockNumber === right.blockNumber
      ? Number(left.logIndex - right.logIndex)
      : Number(left.blockNumber - right.blockNumber)
  ));
  const executionIds = new Set();
  for (const settlement of settlements) {
    invariant(!executionIds.has(settlement.executionId), "execution ID was emitted more than once");
    executionIds.add(settlement.executionId);
    invariant(settlement.blockNumber >= FEE_MONITOR_CONSTANTS.publicReleaseBlock, "settlement predates public release");
    invariant(settlement.blockNumber <= confirmedToBlock, "settlement is not confirmed");
    const receipt = await rpc("eth_getTransactionReceipt", [settlement.transactionHash]);
    invariant(receipt && typeof receipt === "object" && !Array.isArray(receipt), "settlement receipt is missing");
    invariant(quantity(receipt.status, "receipt status") === 1n, "settlement receipt reverted");
    invariant(address(receipt.to, "receipt target") === FEE_MONITOR_CONSTANTS.executor, "receipt target changed");
    invariant(quantity(receipt.blockNumber, "receipt block number") === settlement.blockNumber, "receipt block changed");
    invariant(hash(receipt.blockHash, "receipt block hash") === settlement.blockHash, "receipt block hash changed");
    const matchingLogs = Array.isArray(receipt.logs) ? receipt.logs.filter((candidate) => (
      typeof candidate?.address === "string"
      && candidate.address.toLowerCase() === FEE_MONITOR_CONSTANTS.executor
      && Array.isArray(candidate.topics)
      && candidate.topics[0]?.toLowerCase() === FEE_MONITOR_CONSTANTS.eventTopic
      && candidate.topics[1]?.toLowerCase() === settlement.executionId
    )) : [];
    invariant(matchingLogs.length === 1, "receipt settlement event is not unique");
  }

  const [executorUsdg, executorWeth, usdgAllowance, wethAllowance, treasuryUsdg, treasuryWeth] = await Promise.all([
    readContractUint(rpc, FEE_MONITOR_CONSTANTS.usdg.address, balanceOfCalldata(FEE_MONITOR_CONSTANTS.executor), "executor USDG balance"),
    readContractUint(rpc, FEE_MONITOR_CONSTANTS.weth.address, balanceOfCalldata(FEE_MONITOR_CONSTANTS.executor), "executor WETH balance"),
    readContractUint(rpc, FEE_MONITOR_CONSTANTS.usdg.address,
      allowanceCalldata(FEE_MONITOR_CONSTANTS.executor, FEE_MONITOR_CONSTANTS.router), "executor USDG allowance"),
    readContractUint(rpc, FEE_MONITOR_CONSTANTS.weth.address,
      allowanceCalldata(FEE_MONITOR_CONSTANTS.executor, FEE_MONITOR_CONSTANTS.router), "executor WETH allowance"),
    readContractUint(rpc, FEE_MONITOR_CONSTANTS.usdg.address, balanceOfCalldata(FEE_MONITOR_CONSTANTS.treasury), "treasury USDG balance"),
    readContractUint(rpc, FEE_MONITOR_CONSTANTS.weth.address, balanceOfCalldata(FEE_MONITOR_CONSTANTS.treasury), "treasury WETH balance")
  ]);
  invariant(executorUsdg === 0n && executorWeth === 0n, "executor retained settlement assets");
  invariant(usdgAllowance === 0n && wethAllowance === 0n, "executor retained router allowance");

  let totalUsdg = 0n;
  let totalWeth = 0n;
  settlements.forEach((settlement) => {
    if (settlement.feeAsset === FEE_MONITOR_CONSTANTS.usdg.address) totalUsdg += settlement.actualRmtFee;
    else totalWeth += settlement.actualRmtFee;
  });
  const warnings = settlements.length === 0 ? ["NO_CONFIRMED_PUBLIC_SETTLEMENTS_OBSERVED"] : [];
  return {
    schemaVersion: 1,
    healthy: true,
    checkedAt,
    readOnly: true,
    hostedScheduleRequired: false,
    readiness: readinessSummary,
    chain: {
      chainId: Number(chainId),
      headBlock: headBlock.toString(),
      confirmedToBlock: confirmedToBlock.toString(),
      confirmations: FEE_MONITOR_CONSTANTS.confirmations.toString(),
      publicReleaseBlock: FEE_MONITOR_CONSTANTS.publicReleaseBlock.toString(),
      publicReleaseBlockHash: FEE_MONITOR_CONSTANTS.publicReleaseBlockHash,
      publicReleaseTimestamp: FEE_MONITOR_CONSTANTS.publicReleaseTimestamp
    },
    executor: {
      address: FEE_MONITOR_CONSTANTS.executor,
      runtimeHash,
      runtimeVerified: true,
      residualBalances: {
        usdgAtomic: executorUsdg.toString(),
        wethAtomic: executorWeth.toString()
      },
      routerAllowances: {
        usdgAtomic: usdgAllowance.toString(),
        wethAtomic: wethAllowance.toString()
      }
    },
    policy: {
      policyId: "RMT_EXECUTION_V1",
      version: 1,
      policyHash: FEE_MONITOR_CONSTANTS.policyHash,
      feeBps: FEE_MONITOR_CONSTANTS.feeBps,
      treasury: FEE_MONITOR_CONSTANTS.treasury
    },
    settlements: {
      count: settlements.length,
      firstBlock: settlements[0]?.blockNumber.toString() ?? null,
      lastBlock: settlements.at(-1)?.blockNumber.toString() ?? null,
      fees: {
        usdg: feeAssetSummary(FEE_MONITOR_CONSTANTS.usdg, totalUsdg),
        weth: feeAssetSummary(FEE_MONITOR_CONSTANTS.weth, totalWeth)
      },
      records: settlements.map((settlement) => ({
        transactionHash: settlement.transactionHash,
        blockNumber: settlement.blockNumber.toString(),
        executionId: settlement.executionId,
        trader: settlement.trader,
        feeAsset: settlement.feeAsset,
        feeSide: settlement.feeSide,
        actualRmtFeeAtomic: settlement.actualRmtFee.toString(),
        grossActualOutputAtomic: settlement.grossActualOutput.toString(),
        actualUserNetOutputAtomic: settlement.actualUserNetOutput.toString()
      }))
    },
    treasuryBalances: {
      usdg: feeAssetSummary(FEE_MONITOR_CONSTANTS.usdg, treasuryUsdg),
      weth: feeAssetSummary(FEE_MONITOR_CONSTANTS.weth, treasuryWeth)
    },
    warnings
  };
}

async function fetchReadiness(origin, fetcher = globalThis.fetch) {
  const response = await fetcher(`${assertHttpsUrl(origin, "production origin")}/api/vnext/readiness`, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  invariant(response?.ok === true, `production readiness returned HTTP ${response?.status ?? "unknown"}`);
  return response.json();
}

async function main() {
  try {
    const rpcUrl = process.env.RMT_FEE_MONITOR_RPC_URL?.trim() || FEE_MONITOR_CONSTANTS.publicRpcUrl;
    const productionOrigin = process.env.RMT_FEE_MONITOR_PRODUCTION_ORIGIN?.trim()
      || FEE_MONITOR_CONSTANTS.productionOrigin;
    const readiness = await fetchReadiness(productionOrigin);
    const result = await inspectPublicFeeSettlements({
      rpc: createRpcReader(rpcUrl),
      readiness
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      healthy: false,
      readOnly: true,
      error: error instanceof Error ? error.message : "Unknown fee-monitor failure."
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
