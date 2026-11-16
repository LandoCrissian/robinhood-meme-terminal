import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "./rpc.mjs";
import { runSafeProbe, summarizeGas } from "./safe.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeAbiParameters, formatEther, toFunctionSelector } = require("viem");
const evidence = new URL("../../docs/evidence/", import.meta.url);
const fixed = new URL("fixed-supply-release/", evidence);
const safePolicy = JSON.parse(readFileSync(new URL("rmt-task046/treasury-safe-initializers.json", evidence)));
const operationsPolicy = JSON.parse(readFileSync(new URL("rmt-task045/operations-safe-policy.json", evidence))).operations;
const blocked = "BLOCKED_NO_BROADCAST";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalHash = /^0x[0-9a-f]{64}$/i;
const arbGasInfo = "0x000000000000000000000000000000000000006c";
const resultValue = (read) => read?.status === "observed" ? read.value : undefined;

function decimal(value) {
  assert.match(value, /^(0|[1-9][0-9]{0,77})$/, "Invalid decimal quantity");
  return BigInt(value);
}

const hexInteger = (value) => {
  assert.match(value, /^0x(0|[1-9a-f][0-9a-f]{0,63})$/i, "Invalid JSON-RPC quantity");
  return BigInt(value);
};

function anchorTag(anchor) {
  assert.ok(canonicalHash.test(anchor.hash), "Invalid block anchor");
  return "0x" + decimal(anchor.number).toString(16);
}

export async function observeFeeReference(anchor, readers, now = Date.now) {
  const tag = anchorTag(anchor);
  const isFresh = (time) => {
    const age = now() - Date.parse(time);
    return age <= 300_000 && age >= -60_000;
  };
  const readHeader = (rpc) => rpc("eth_getBlockByNumber", [tag, false], (block) => ({
    number: hexInteger(block.number).toString(), hash: block.hash,
    time: new Date(Number(hexInteger(block.timestamp)) * 1000).toISOString(),
    baseFeeWei: hexInteger(block.baseFeePerGas).toString(),
  }));
  const observations = await Promise.all(Object.entries(readers).map(async ([provider, rpc]) => {
    const chain = await rpc("eth_chainId", [], (value) => hexInteger(value).toString());
    if (resultValue(chain) !== "4663") return { provider, chain };
    const before = await readHeader(rpc);
    if (!resultValue(before) || before.value.hash !== anchor.hash || before.value.number !== anchor.number ||
        before.value.time !== anchor.blockTimeUtc) return { provider, chain, before };
    const l1Base = await rpc("eth_call", [{ to: arbGasInfo, data: toFunctionSelector("getL1BaseFeeEstimate()") }, tag],
      (data) => {
        assert.match(data, canonicalHash);
        return decodeAbiParameters([{ type: "uint256" }], data)[0].toString();
      });
    const after = await readHeader(rpc);
    return { provider, chain, before, l1Base, after };
  }));
  const isAnchor = (header) => header?.hash === anchor.hash && header.number === anchor.number && header.time === anchor.blockTimeUtc;
  const headerReads = observations.flatMap(({ before, after }) => [resultValue(before), resultValue(after)].filter(Boolean));
  const providers = observations.filter(({ before, after }) => isAnchor(resultValue(before)) &&
    isAnchor(resultValue(after)) && before.value.baseFeeWei === after.value.baseFeeWei && decimal(before.value.baseFeeWei) > 0n);
  const official = providers.find(({ provider }) => provider === "official");
  const price = official?.before.value.baseFeeWei;
  const agrees = headerReads.every((header) => isAnchor(header) && header.baseFeeWei === price);
  const valid = Boolean(official && providers.length >= 2 && agrees && isFresh(anchor.blockTimeUtc));
  const l1Prices = providers.map(({ l1Base }) => resultValue(l1Base)).filter((value) => value !== undefined);
  const l1Reference = valid && l1Prices.length >= 2 && l1Prices.every((price) => price === l1Prices[0]) ? l1Prices[0] : null;
  return {
    status: valid ? "CORROBORATED_BLOCK_BASE_FEE" : "UNVERIFIED",
    anchor, providers: valid ? providers.map(({ provider }) => provider) : [],
    baseFeeWei: valid ? price : null, l1BaseFeeReferenceWei: l1Reference, observations,
  };
}

export function fixtureCostRows() {
  const manifest = JSON.parse(readFileSync(new URL("release-manifest.json", fixed)));
  const bundleText = readFileSync(new URL("unsigned-bundle.json", fixed), "utf8").replaceAll("\r\n", "\n");
  assert.equal(sha256(bundleText), manifest.unsignedBundleSha256Lf);
  const bundle = JSON.parse(bundleText);
  assert.equal(bundle.status, blocked);
  assert.equal(bundle.broadcastAuthorized, false);
  assert.equal(bundle.chainId, 4663);
  assert.deepEqual(bundle.production.transactions, []);
  const archive = readFileSync(new URL("fork-4663.json.gz", fixed));
  assert.equal(sha256(archive), manifest.fork.archiveSha256);
  const bytes = gunzipSync(archive);
  assert.equal(sha256(bytes), manifest.fork.reportSha256);
  const fork = JSON.parse(bytes);
  assert.equal(fork.report.execution.host, "127.0.0.1");
  assert.equal(fork.report.execution.chainId, 4663);
  assert.equal(fork.report.network.blockHash, manifest.fork.blockHash);
  assert.equal(fork.manifest.inputSha256, bundle.compiler.inputSha256);
  const { constructors, publication, templatePublication } = fork.deployment.deployment;
  const [first] = fork.projects;
  assert.equal(first.symbol, "RMT");
  const value = decimal(bundle.provisionalTerms.creationFeeWei).toString();
  assert.equal(first.unsigned.value, value);
  const constructorReceipts = [
    constructors.directory.receipt, constructors.registry.receipt, constructors.v2.receipt, constructors.v3.receipt,
    fork.deployment.deployment,
  ];
  const constructorLabels = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
  assert.deepEqual(bundle.fixtureOnly.transactions.map(({ name }) => name), constructorLabels);
  const items = bundle.fixtureOnly.transactions.map(({ name, observedForkGasUsed, observedForkReceipt }, index) => {
    const receipt = constructorReceipts[index];
    assert.equal(receipt.gasUsed, observedForkGasUsed);
    assert.equal(receipt.transactionHash, observedForkReceipt);
    return [name, receipt, "0"];
  });
  items.push(
    ["factory-schedule", publication.scheduled, "0"],
    ["factory-execute", publication.executed, "0"],
    ["v3-template-schedule", templatePublication.scheduled, "0"],
    ["v3-template-execute", templatePublication.executed, "0"],
    ["first-rmt-project", first.creation, value],
  );
  assert.equal(first.creation.transactionHash, manifest.fork.projects[0].creation);
  return {
    compilerInputSha256: bundle.compiler.inputSha256,
    forkAnchor: bundle.fixtureOnly.anchor,
    reportSha256: manifest.fork.reportSha256,
    rows: items.map(([action, receipt, provisionalValueWei]) => {
      assert.equal(receipt.status, "success");
      assert.match(receipt.transactionHash, canonicalHash);
      assert.ok(decimal(receipt.gasUsed) > 0n);
      return { action, gasUsedOnFork: receipt.gasUsed, forkReceipt: receipt.transactionHash, provisionalValueWei };
    }),
  };
}

function summarizeSafeEstimates(report) {
  const complete = report.status === "READ_ONLY_ESTIMATED" && report.anchorRechecked === true;
  if (complete) {
    assert.equal(report.chainId, 4663);
    assert.equal(report.broadcastAuthorized, false);
    assert.equal(report.gasPayerAuthority, "READ_ONLY_ESTIMATION_ONLY");
    assert.equal(report.proposedGasPayer, operationsPolicy.owners[0]);
    assert.equal(report.proposals.length, 2);
  }
  return safePolicy.proposals.map(({ role, counterfactualAddress, saltNonce }) => {
    const proposal = report.proposals.find((proposal) => proposal.role === role);
    if (!complete || !proposal?.gas) return { role, counterfactualAddress, saltNonce, gas: null };
    assert.equal(proposal.counterfactualAddress, counterfactualAddress);
    assert.equal(proposal.saltNonce, saltNonce);
    assert.equal(proposal.vacancy.status, "VACANT");
    assert.equal(proposal.simulation.value, counterfactualAddress);
    const gas = proposal.gas;
    // Independently recompute the linked Safe fee model before using its totals.
    assert.deepEqual(gas, summarizeGas({ total: decimal(gas.nitroGasEstimate), l1: decimal(gas.l1PosterGasUnits),
      baseFee: decimal(gas.l2BaseFeeWei), l1BaseFee: decimal(gas.l1BaseFeeEstimateWei), estimateGas: decimal(gas.rpcEstimateGas) }));
    return { role, counterfactualAddress, saltNonce, gas };
  });
}

export function buildDeploymentCostReport({ mode, safes, reference }) {
  assert.ok(["PUBLIC_READ_ONLY", "ARCHIVED_ARITHMETIC_FIXTURE"].includes(mode));
  const fixture = fixtureCostRows();
  const hasPrice = mode === "PUBLIC_READ_ONLY" && reference?.status === "CORROBORATED_BLOCK_BASE_FEE";
  if (hasPrice) assert.deepEqual(reference.anchor, safes.anchor);
  const price = hasPrice ? decimal(reference.baseFeeWei) : null;
  assert.ok(price === null || price > 0n);
  const safeRows = summarizeSafeEstimates(safes);
  const safeTotal = safeRows.every(({ gas }) => gas)
    ? safeRows.reduce((total, { gas }) => total + decimal(gas.estimatedTotalWei), 0n) : null;
  if (safeTotal !== null) assert.equal(safeTotal.toString(), safes.combinedEstimatedWei);
  const protocolRows = fixture.rows.map((row) => ({
    ...row, illustrativeExecutionWei: price === null ? null : (decimal(row.gasUsedOnFork) * price).toString(),
    mainnetL1PosterWei: null, mainnetTotalNetworkFeeWei: null,
  }));
  const measuredGas = fixture.rows.reduce((total, row) => total + decimal(row.gasUsedOnFork), 0n);
  const execution = price === null ? null : formatEther(measuredGas * price);
  const creationFeeWei = fixture.rows.at(-1).provisionalValueWei;
  return {
    schemaVersion: 1, status: blocked, broadcastAuthorized: false, chainId: 4663, mode,
    safeEstimates: { scope: mode === "PUBLIC_READ_ONLY" ? "PUBLIC_RPC_SIMULATION" : "ARCHIVED_PUBLIC_RPC_SIMULATION",
      observedAt: safes.observedAt, anchor: safes.anchor ?? null, proposedGasPayer: safes.proposedGasPayer,
      status: safes.status, rows: safeRows, totalNetworkFeeWei: safeTotal?.toString() ?? null,
      totalNetworkFeeEth: safeTotal === null ? null : formatEther(safeTotal) },
    networkReference: reference ?? null,
    protocolCosts: { scope: "LOOPBACK_RECEIPT_GAS_AT_LIVE_BASE_FEE_EXECUTION_ONLY",
      compilerInputSha256: fixture.compilerInputSha256, forkAnchor: fixture.forkAnchor, forkReportSha256: fixture.reportSha256,
      rows: protocolRows, observedForkGasUsedTotal: measuredGas.toString(), illustrativeExecutionSubtotalEth: execution,
      provisionalFirstProjectCreationFeeWei: creationFeeWei, provisionalFirstProjectCreationFeeEth: formatEther(decimal(creationFeeWei)),
      creatorPurchaseOrLiquidityDepositWei: "0", mainnetExactEstimate: "BLOCKED_UNBOUND_PRODUCTION_INPUTS",
      liveTransactions: [], mainnetTotalNetworkFeeWei: null },
  };
}

const makeReaders = () => Object.fromEntries(Object.entries(ROBINHOOD_SOURCES).map(([name, url]) => [name, makeReadOnlyRpc({ name, url })]));

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { live: { type: "boolean" }, fixture: { type: "boolean" }, output: { type: "string" } } });
  assert.notEqual(Boolean(values.live), Boolean(values.fixture), "Specify exactly one of --live or --fixture");
  const mode = values.live ? "PUBLIC_READ_ONLY" : "ARCHIVED_ARITHMETIC_FIXTURE";
  const readers = values.live ? makeReaders() : null;
  const safes = readers ? await runSafeProbe({ readers }) :
    JSON.parse(gunzipSync(readFileSync(new URL("production-readiness/acceptance-observations.json.gz", evidence)))).safes;
  const reference = readers && safes.anchor ? await observeFeeReference(safes.anchor, readers) : null;
  const report = JSON.stringify(buildDeploymentCostReport({ mode, safes, reference }), null, 2) + "\n";
  if (values.output) writeFileSync(values.output, report, { flag: "wx" });
  else process.stdout.write(report);
}
