import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  decodeSettlementLog,
  FEE_MONITOR_CONSTANTS,
  inspectPublicFeeSettlements,
  READ_ONLY_RPC_METHODS,
  validateProductionReadiness
} from "./uniswap-v3-fee-settlement-monitor.mjs";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function hashWord(value) {
  return value.slice(2).toLowerCase();
}

function addressWord(value) {
  return value.slice(2).toLowerCase().padStart(64, "0");
}

function healthyReadiness() {
  return {
    mode: "interactive",
    shellEnabled: true,
    configurationConsistent: true,
    execution: {
      authorizationClientEnabled: true,
      authorizationServerEnabled: true,
      walletSubmissionEnabled: true
    },
    providers: {
      uniswapV3FeeExecutor: {
        policyEnabled: true,
        configured: true,
        releaseScope: "public",
        strictVerificationAvailable: true,
        walletAuthorizationAvailable: true,
        authorizationEnabled: true,
        publicAuthorizationEnabled: true,
        publicProofBindingValid: true,
        deployedAndVerified: true,
        mainnetProofComplete: true
      }
    }
  };
}

function settlementLog(overrides = {}) {
  const feeSide = overrides.feeSide ?? 0n;
  const userGrossInput = overrides.userGrossInput ?? 1_000_000n;
  const actualRmtFee = overrides.actualRmtFee ?? (feeSide === 0n ? 2_500n : 5_000n);
  const providerInput = overrides.providerInput ?? (feeSide === 0n ? userGrossInput - actualRmtFee : userGrossInput);
  const grossActualOutput = overrides.grossActualOutput ?? (feeSide === 0n ? 500_000_000_000_000n : 2_000_000n);
  const actualUserNetOutput = overrides.actualUserNetOutput
    ?? (feeSide === 0n ? grossActualOutput : grossActualOutput - actualRmtFee);
  const words = [
    hashWord(overrides.policyIdHash ?? FEE_MONITOR_CONSTANTS.policyIdHash),
    word(overrides.policyVersion ?? 1n),
    hashWord(overrides.providerId ?? FEE_MONITOR_CONSTANTS.providerId),
    addressWord(overrides.router ?? FEE_MONITOR_CONSTANTS.router),
    hashWord(overrides.routeIdentity ?? `0x${"44".repeat(32)}`),
    addressWord(overrides.feeAsset ?? FEE_MONITOR_CONSTANTS.usdg.address),
    word(overrides.feeBps ?? 25n),
    word(feeSide),
    word(userGrossInput),
    word(providerInput),
    word(grossActualOutput),
    word(actualRmtFee),
    word(actualUserNetOutput),
    addressWord(overrides.treasury ?? FEE_MONITOR_CONSTANTS.treasury)
  ];
  return {
    address: overrides.address ?? FEE_MONITOR_CONSTANTS.executor,
    topics: [
      overrides.eventTopic ?? FEE_MONITOR_CONSTANTS.eventTopic,
      overrides.executionId ?? `0x${"11".repeat(32)}`,
      overrides.policyHash ?? FEE_MONITOR_CONSTANTS.policyHash,
      `0x${addressWord(overrides.trader ?? "0x1111111111111111111111111111111111111111")}`
    ],
    data: `0x${words.join("")}`,
    transactionHash: overrides.transactionHash ?? `0x${"22".repeat(32)}`,
    blockHash: overrides.blockHash ?? `0x${"33".repeat(32)}`,
    blockNumber: overrides.blockNumber ?? `0x${(FEE_MONITOR_CONSTANTS.publicReleaseBlock + 1n).toString(16)}`,
    logIndex: overrides.logIndex ?? "0x0",
    removed: overrides.removed ?? false
  };
}

function padded(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function monitorRpc({ logs = [], residual = 0n, allowance = 0n, releaseHash, receiptStatus = "0x1" } = {}) {
  const calls = [];
  const rpc = async (method, params = []) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") {
      return `0x${(FEE_MONITOR_CONSTANTS.publicReleaseBlock + 100n).toString(16)}`;
    }
    if (method === "eth_getBlockByNumber") return {
      number: `0x${FEE_MONITOR_CONSTANTS.publicReleaseBlock.toString(16)}`,
      hash: releaseHash ?? FEE_MONITOR_CONSTANTS.publicReleaseBlockHash,
      timestamp: `0x${Math.floor(new Date(FEE_MONITOR_CONSTANTS.publicReleaseTimestamp).getTime() / 1_000).toString(16)}`
    };
    if (method === "eth_getCode") return "0x6001600055";
    if (method === "web3_sha3") return FEE_MONITOR_CONSTANTS.executorRuntimeHash;
    if (method === "eth_getLogs") return logs;
    if (method === "eth_getTransactionReceipt") {
      const log = logs.find((candidate) => candidate.transactionHash.toLowerCase() === params[0].toLowerCase());
      return {
        status: receiptStatus,
        to: FEE_MONITOR_CONSTANTS.executor,
        blockNumber: log?.blockNumber,
        blockHash: log?.blockHash,
        logs: log ? [log] : []
      };
    }
    if (method === "eth_call") {
      const data = params[0]?.data ?? "";
      if (data.startsWith("0xdd62ed3e")) return padded(allowance);
      const owner = data.slice(-40).toLowerCase();
      if (owner === FEE_MONITOR_CONSTANTS.executor.slice(2)) return padded(residual);
      return padded(250n);
    }
    throw new Error(`unexpected method ${method}`);
  };
  return { rpc, calls };
}

test("production readiness requires the complete public fee release", () => {
  const result = validateProductionReadiness(healthyReadiness());
  assert.equal(result.releaseScope, "public");
  assert.equal(result.publicAuthorizationEnabled, true);
});

test("disabled public authorization fails closed", () => {
  const readiness = healthyReadiness();
  readiness.providers.uniswapV3FeeExecutor.publicAuthorizationEnabled = false;
  assert.throws(() => validateProductionReadiness(readiness), /public fee authorization is disabled/u);
});

test("input-side settlement decodes exact policy economics", () => {
  const decoded = decodeSettlementLog(settlementLog());
  assert.equal(decoded.feeSide, "input");
  assert.equal(decoded.actualRmtFee, 2_500n);
  assert.equal(decoded.providerInput, 997_500n);
});

test("output-side positive slippage fee may remain below policy candidate", () => {
  const decoded = decodeSettlementLog(settlementLog({
    feeSide: 1n,
    providerInput: 1_000_000n,
    grossActualOutput: 3_000_000n,
    actualRmtFee: 5_000n,
    actualUserNetOutput: 2_995_000n,
    feeAsset: FEE_MONITOR_CONSTANTS.weth.address
  }));
  assert.equal(decoded.feeSide, "output");
  assert.equal(decoded.actualRmtFee, 5_000n);
});

test("mutated policy and malformed event data fail closed", () => {
  assert.throws(() => decodeSettlementLog(settlementLog({ policyHash: `0x${"99".repeat(32)}` })), /policy hash changed/u);
  assert.throws(() => decodeSettlementLog({ ...settlementLog(), data: "0x00" }), /data length changed/u);
});

test("healthy no-settlement state is explicit and read-only", async () => {
  const { rpc, calls } = monitorRpc();
  const result = await inspectPublicFeeSettlements({ rpc, readiness: healthyReadiness(), checkedAt: "2026-08-16T08:00:00.000Z" });
  assert.equal(result.healthy, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.settlements.count, 0);
  assert.deepEqual(result.warnings, ["NO_CONFIRMED_PUBLIC_SETTLEMENTS_OBSERVED"]);
  assert.equal(result.executor.residualBalances.usdgAtomic, "0");
  assert.ok(calls.every(({ method }) => READ_ONLY_RPC_METHODS.includes(method)));
});

test("confirmed settlement is receipt-bound and aggregated", async () => {
  const log = settlementLog();
  const { rpc } = monitorRpc({ logs: [log] });
  const result = await inspectPublicFeeSettlements({ rpc, readiness: healthyReadiness() });
  assert.equal(result.settlements.count, 1);
  assert.equal(result.settlements.fees.usdg.atomic, "2500");
  assert.equal(result.settlements.fees.usdg.display, "0.0025");
  assert.deepEqual(result.warnings, []);
});

test("duplicate execution IDs are rejected", async () => {
  const first = settlementLog({ transactionHash: `0x${"22".repeat(32)}`, logIndex: "0x0" });
  const second = settlementLog({ transactionHash: `0x${"55".repeat(32)}`, logIndex: "0x1" });
  const { rpc } = monitorRpc({ logs: [first, second] });
  await assert.rejects(() => inspectPublicFeeSettlements({ rpc, readiness: healthyReadiness() }), /execution ID was emitted more than once/u);
});

test("release-block reorg evidence fails closed", async () => {
  const { rpc } = monitorRpc({ releaseHash: `0x${"77".repeat(32)}` });
  await assert.rejects(() => inspectPublicFeeSettlements({ rpc, readiness: healthyReadiness() }), /release block hash changed/u);
});

test("executor residual balance and router allowance fail closed", async () => {
  const residual = monitorRpc({ residual: 1n });
  await assert.rejects(() => inspectPublicFeeSettlements({ rpc: residual.rpc, readiness: healthyReadiness() }), /retained settlement assets/u);
  const allowance = monitorRpc({ allowance: 1n });
  await assert.rejects(() => inspectPublicFeeSettlements({ rpc: allowance.rpc, readiness: healthyReadiness() }), /retained router allowance/u);
});

test("reverted settlement receipt fails closed", async () => {
  const { rpc } = monitorRpc({ logs: [settlementLog()], receiptStatus: "0x0" });
  await assert.rejects(() => inspectPublicFeeSettlements({ rpc, readiness: healthyReadiness() }), /receipt reverted/u);
});

test("RPC surface and implementation contain no write or wallet operations", async () => {
  assert.deepEqual(READ_ONLY_RPC_METHODS, [
    "eth_blockNumber",
    "eth_call",
    "eth_chainId",
    "eth_getBlockByNumber",
    "eth_getCode",
    "eth_getLogs",
    "eth_getTransactionReceipt",
    "web3_sha3"
  ]);
  const source = await readFile(fileURLToPath(new URL("./uniswap-v3-fee-settlement-monitor.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /eth_send|sendTransaction|signTransaction|privateKey|mnemonic|walletClient|setInterval|setTimeout/u);
});
