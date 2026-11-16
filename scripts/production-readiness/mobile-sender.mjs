import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeReadOnlyRpc, MOBILE_DEPLOYMENT_PAYER, ROBINHOOD_SOURCES } from "./rpc.mjs";
import { runSafeProbe, summarizeGas } from "./safe.mjs";

export { MOBILE_DEPLOYMENT_PAYER };
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { getContractAddress, isAddressEqual, keccak256 } = require("viem");
const evidence = new URL("../../docs/evidence/", import.meta.url);
const load = (path) => JSON.parse(readFileSync(new URL(path, evidence), "utf8"));
const safeTemplate = load("rmt-task045/operations-safe-policy.json").operations;
const safeProposals = load("rmt-task046/treasury-safe-initializers.json");
const safeRegistry = load("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const safePins = [safeRegistry.safe_l2, safeRegistry.safe_proxy_factory, safeRegistry.compatibility_fallback_handler]
  .map(({ address, registryRuntimeKeccak256: hash }) => ({ address, hash }));
const knownProviders = Object.keys(ROBINHOOD_SOURCES);
const scope = "READ_ONLY_4663_MOBILE_PREPARATION";
const blocked = "BLOCKED_NO_BROADCAST";
const maxAgeMs = 120_000;
const maxNonce = (1n << 64n) - 1n;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const hexPattern = /^0x(?:[0-9a-f]{2})*$/i;
const decimalPattern = /^(?:0|[1-9][0-9]{0,77})$/;
const value = (observation) => observation?.status === "observed" ? observation.value : undefined;
const hex = (number) => "0x" + BigInt(number).toString(16);

const decimal = (input) => {
  assert.match(input, /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i);
  return BigInt(input).toString();
};
const codeOnly = (input) => {
  assert.match(input, hexPattern);
  return input.toLowerCase();
};

function header(raw) {
  assert.match(raw.hash, hashPattern);
  assert.ok(BigInt(raw.hash) !== 0n);
  return {
    number: decimal(raw.number), hash: raw.hash.toLowerCase(),
    blockTimeUtc: new Date(Number(decimal(raw.timestamp)) * 1000).toISOString(),
  };
}

function sameBlock(a, b) {
  return a && b && a.number === b.number && a.hash === b.hash && a.blockTimeUtc === b.blockTimeUtc;
}

const freshBlock = (anchor, now) => anchor && decimalPattern.test(anchor.number) && hashPattern.test(anchor.hash) &&
  BigInt(anchor.hash) !== 0n && Date.parse(anchor.blockTimeUtc) <= now + 10_000 &&
  Date.parse(anchor.blockTimeUtc) >= now - maxAgeMs;

export function deriveFutureCreateDestinations(pendingNonce) {
  assert.match(pendingNonce, decimalPattern);
  const baseNonce = BigInt(pendingNonce) + 2n; // One sender slot for each separately reviewed Safe deployment.
  assert.ok(baseNonce + 4n < maxNonce, "Insufficient sender nonce space");
  return Array.from({ length: 5 }, (_, i) => {
    const nonce = baseNonce + BigInt(i);
    return { deploymentNonce: nonce.toString(), address: getContractAddress({ from: MOBILE_DEPLOYMENT_PAYER, nonce }) };
  });
}

function corroborated(witnesses, key) {
  const available = witnesses.flatMap(({ name, [key]: row }) => row === undefined ? [] : [{ name, row }]);
  if (available.some(({ row }) => row !== available[0].row)) return { status: "CONFLICT" };
  if (available.length < 2 || !available.some(({ name }) => name === "official")) return { status: "UNVERIFIED" };
  return { status: "CORROBORATED", value: available[0].row };
}

function accountSummary(witnesses, anchor) {
  const result = { status: "UNVERIFIED", anchor, accountType: null, balanceWei: null,
    confirmedNonce: null, pendingNonce: null, nonceSynchronized: false, providers: witnesses };
  if (witnesses.some(({ chainId, before, after, pendingBefore, pendingAfter }) =>
    (chainId !== undefined && chainId !== "4663") || (before && !sameBlock(anchor, before)) ||
    (after && !sameBlock(anchor, after)) ||
    (pendingBefore !== undefined && pendingAfter !== undefined && pendingBefore !== pendingAfter))) {
    return { ...result, status: "CONFLICT" };
  }
  const stable = witnesses.filter(({ chainId, before, after, pendingBefore, pendingAfter, code, balanceWei, confirmedNonce }) =>
    chainId === "4663" && sameBlock(before, anchor) && sameBlock(after, anchor) &&
    pendingBefore !== undefined && pendingBefore === pendingAfter &&
    code !== undefined && balanceWei !== undefined && confirmedNonce !== undefined);
  const code = corroborated(stable, "code");
  const balanceWei = corroborated(stable, "balanceWei");
  const confirmed = corroborated(stable, "confirmedNonce");
  const pending = corroborated(stable, "pendingAfter");
  if ([code, balanceWei, confirmed, pending].some(({ status }) => status === "CONFLICT")) return { ...result, status: "CONFLICT" };
  if ([code, balanceWei, confirmed, pending].some(({ status }) => status !== "CORROBORATED")) return result;
  if (BigInt(pending.value) < BigInt(confirmed.value)) return { ...result, status: "CONFLICT" };
  const accountType = code.value === "0x" ? "CODE_EMPTY" :
    /^0xef0100[0-9a-f]{40}$/.test(code.value) ? "EIP_7702_DELEGATION" : "CONTRACT_CODE";
  return { ...result, status: "OBSERVED", accountType, balanceWei: balanceWei.value, confirmedNonce: confirmed.value,
    pendingNonce: pending.value, nonceSynchronized: confirmed.value === pending.value };
}

const makeReaders = () => Object.fromEntries(knownProviders.map((name) =>
  [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] }, { mobileSafePayer: true })]));

export async function observeMobileSender({ readers = makeReaders(), now = Date.now, anchor } = {}) {
  const providers = knownProviders.filter((name) => typeof readers[name] === "function");
  const initial = await Promise.all(providers.map(async (name) => {
    const read = readers[name];
    const [chainId, latest] = await Promise.all([read("eth_chainId", [], decimal), read("eth_getBlockByNumber", ["latest", false], header)]);
    return { name, chainId: value(chainId), latest: value(latest) };
  }));
  if (!anchor) {
    const heads = initial.filter(({ latest, chainId }) => latest && chainId === "4663")
      .sort((a, b) => BigInt(a.latest.number) < BigInt(b.latest.number) ? -1 :
        BigInt(a.latest.number) > BigInt(b.latest.number) ? 1 : 0);
    anchor = heads[0]?.latest;
  }
  if (!freshBlock(anchor, now())) return { ...accountSummary(initial, anchor ?? null), createDestinations: [] };

  const tag = hex(anchor.number);
  const readHeader = async (reader) => value(await reader("eth_getBlockByNumber", [tag, false], header));
  const readPending = async (reader) => value(await reader("eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, "pending"], decimal));
  const witnesses = await Promise.all(initial.map(async (initialRead) => {
    const { name, chainId } = initialRead;
    if (chainId !== "4663") return initialRead;
    const read = readers[name];
    const before = await readHeader(read);
    if (!sameBlock(anchor, before)) return { ...initialRead, before };
    const pendingBefore = await readPending(read);
    const [code, balance, nonce] = await Promise.all([
      read("eth_getCode", [MOBILE_DEPLOYMENT_PAYER, tag], codeOnly),
      read("eth_getBalance", [MOBILE_DEPLOYMENT_PAYER, tag], decimal),
      read("eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, tag], decimal),
    ]);
    return { ...initialRead, before, pendingBefore, pendingAfter: await readPending(read), after: await readHeader(read),
      code: value(code), balanceWei: value(balance), confirmedNonce: value(nonce) };
  }));
  const sender = accountSummary(witnesses, anchor);
  const predicted = sender.status === "OBSERVED" && sender.accountType === "CODE_EMPTY" && sender.nonceSynchronized
    ? deriveFutureCreateDestinations(sender.pendingNonce) : [];
  const createDestinations = [];
  const participants = witnesses.filter(({ name, before, after }) => readers[name] && sameBlock(anchor, before) && sameBlock(anchor, after));
  for (const proposal of predicted) {
    const checks = await Promise.all(participants.map(async ({ name }) => {
      const read = readers[name];
      const [code, nonce] = await Promise.all([
        read("eth_getCode", [proposal.address, tag], codeOnly), read("eth_getTransactionCount", [proposal.address, tag], decimal),
      ]);
      return { name, code: value(code), nonce: value(nonce) };
    }));
    createDestinations.push({ ...proposal, ...destinationStatus(checks), providers: checks });
  }
  if (predicted.length) {
    await Promise.all(participants.map(async (witness) => {
      const read = readers[witness.name];
      witness.after = await readHeader(read);
      witness.pendingAfter = await readPending(read);
    }));
  }
  const rechecked = accountSummary(witnesses, anchor);
  return { ...rechecked, createDestinations: rechecked.status === "OBSERVED" && rechecked.nonceSynchronized ? createDestinations : [] };
}

function destinationStatus(checks) {
  const settled = checks.filter(({ code, nonce }) => code !== undefined && nonce !== undefined);
  const code = corroborated(settled, "code");
  const nonce = corroborated(settled, "nonce");
  if ([code, nonce].some(({ status }) => status === "CONFLICT")) return { status: "CONFLICT" };
  if ([code, nonce].some(({ status }) => status !== "CORROBORATED")) return { status: "UNVERIFIED" };
  return { status: code.value === "0x" && nonce.value === "0" ? "VACANT" : "OCCUPIED", code: code.value,
    accountNonce: nonce.value };
}

async function summarizeSafes(report, readers, sender) {
  const participants = sender.providers.filter(({ chainId, before, after }) =>
    chainId === "4663" && sameBlock(sender.anchor, before) && sameBlock(sender.anchor, after));
  const runtimePins = await Promise.all(safePins.map(async ({ address, hash }) => {
    const checks = sameBlock(report.anchor, sender.anchor) ? await Promise.all(participants.map(async ({ name }) =>
      ({ name, observedHash: value(await readers[name]("eth_getCode", [address, hex(report.anchor.number)],
        (code) => keccak256(codeOnly(code)))) }))) : [];
    return { address, hash, witnesses: checks };
  }));
  const proposals = report.proposals.map((proposal) => {
    const observations = proposal.vacancy ?? {};
    const vacancy = knownProviders.flatMap((name) => {
      const readings = observations[name];
      return Array.isArray(readings)
        ? [{ name, code: value(readings[0]), nonce: value(readings[1]), balanceWei: value(readings[2]) }] : [];
    });
    return { role: proposal.role, counterfactualAddress: proposal.counterfactualAddress, create2Salt: proposal.create2Salt,
      saltNonce: proposal.saltNonce, initializerKeccak256: proposal.initializerKeccak256,
      simulatedAddress: value(proposal.simulation) ?? null, vacancy, gas: proposal.gas ?? null,
      estimateStatus: proposal.estimateGas?.status ?? "unavailable",
      estimationRpcCode: proposal.estimateGas?.rpcCode ?? null };
  });
  return { anchor: report.anchor ?? null, probeStatus: report.status, runtimePins,
    safeVersion: report.safeVersion, payer: report.proposedGasPayer, owners: report.owners, threshold: report.threshold,
    factory: report.factory, singleton: report.singleton, initcodeHash: report.initcodeHash ?? null, proposals,
    estimatedTotalWei: report.combinedEstimatedWei ?? null, estimatedTotalEth: report.combinedEstimatedEth ?? null,
    budgetAtObservation: sender.status === "OBSERVED" && report.combinedEstimatedWei !== null && report.combinedEstimatedWei !== undefined
      ? BigInt(sender.balanceWei) >= BigInt(report.combinedEstimatedWei) : null };
}

export async function runMobileSenderProbe({ readers = makeReaders(), now = Date.now } = {}) {
  const quote = await runSafeProbe({ readers, now, mobileSafePayer: true });
  const observedSender = await observeMobileSender({ readers, now, anchor: quote.anchor });
  const safes = await summarizeSafes(quote, readers, observedSender);
  // Recheck the pinned header and the pending account nonce after the independent Safe reads.
  const sender = observedSender;
  await Promise.all(sender.providers.map(async (peer) => {
    if (!sameBlock(peer.after, sender.anchor)) return;
    peer.after = value(await readers[peer.name]("eth_getBlockByNumber", [hex(sender.anchor.number), false], header));
    peer.pendingAfter = value(await readers[peer.name]("eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, "pending"], decimal));
  }));
  const evidenceTime = now();
  const finalSender = accountSummary(sender.providers, sender.anchor);
  return { schemaVersion: 1, scope, status: blocked, broadcastAuthorized: false, chainId: 4663,
    observedAt: new Date(evidenceTime).toISOString(), expiresAt: new Date(evidenceTime + maxAgeMs).toISOString(),
    proposedSender: MOBILE_DEPLOYMENT_PAYER, observedSignerControl: "UNVERIFIED",
    sender: { ...finalSender, createDestinations: finalSender.status === "OBSERVED" && finalSender.nonceSynchronized
      ? sender.createDestinations : [] }, safes };
}

function admittedWitnessNames(rows) {
  assert.ok(Array.isArray(rows) && rows.length >= 2 && rows.length <= knownProviders.length);
  const names = rows.map(({ name }) => name);
  assert.equal(new Set(names).size, rows.length, "Duplicate provider");
  assert.ok(names.every((name) => knownProviders.includes(name)), "Unrecognized provider");
}

// An observation is admissible only for a blocked review. This validator never grants signing authority.
export function assertCurrentMobileObservation(observation, nowMs = Date.now()) {
  assert.ok(observation?.schemaVersion === 1 && observation.scope === scope && observation.status === blocked &&
    observation.broadcastAuthorized === false && observation.chainId === 4663, "Unrecognized or unblocked observation");
  assert.equal(observation.proposedSender, MOBILE_DEPLOYMENT_PAYER);
  assert.equal(observation.observedSignerControl, "UNVERIFIED");
  const observed = Date.parse(observation.observedAt);
  assert.ok(Number.isFinite(nowMs) && observed <= nowMs && Date.parse(observation.expiresAt) === observed + maxAgeMs &&
    nowMs <= observed + maxAgeMs && freshBlock(observation.sender?.anchor, nowMs), "Stale or invalid proof");
  const { sender, safes } = observation;
  admittedWitnessNames(sender.providers);
  const summary = accountSummary(sender.providers, sender.anchor);
  assert.ok(summary.status === "OBSERVED" && summary.accountType === "CODE_EMPTY" && summary.nonceSynchronized,
    "Corroborated, code-empty account with equal pending and confirmed nonce required");
  const fields = ["status", "accountType", "balanceWei", "confirmedNonce", "pendingNonce", "nonceSynchronized"];
  for (const field of fields) assert.equal(sender[field], summary[field], "Sender summary mismatch");
  for (const key of ["balanceWei", "confirmedNonce", "pendingNonce"]) assert.match(sender[key], decimalPattern);
  const predicted = deriveFutureCreateDestinations(sender.pendingNonce);
  assert.equal(sender.createDestinations.length, predicted.length);
  for (const [i, destination] of sender.createDestinations.entries()) {
    assert.equal(destination.address, predicted[i].address);
    assert.equal(destination.deploymentNonce, predicted[i].deploymentNonce);
    admittedWitnessNames(destination.providers);
    const vacancy = { status: "VACANT", code: "0x", accountNonce: "0" };
    assert.deepEqual(destinationStatus(destination.providers), vacancy,
      "Future CREATE destination occupancy not corroborated");
    for (const key of Object.keys(vacancy)) assert.equal(destination[key], vacancy[key], "CREATE destination summary mismatch");
  }
  assert.ok(sameBlock(safes.anchor, sender.anchor), "Safe and sender observation differ");
  assert.equal(safes.payer, MOBILE_DEPLOYMENT_PAYER);
  assert.deepEqual(safes.owners, safeTemplate.owners);
  assert.ok(safes.owners.every((owner) => !isAddressEqual(owner, MOBILE_DEPLOYMENT_PAYER)), "Personal payer cannot be a Safe owner");
  assert.equal(safes.safeVersion, safeTemplate.safeProfile);
  assert.equal(safes.threshold, safeTemplate.threshold);
  assert.equal(safes.factory, safeTemplate.factory);
  assert.equal(safes.singleton, safeTemplate.singleton);
  assert.equal(safes.initcodeHash, safeProposals.initcodeKeccak256);
  assert.equal(safes.runtimePins.length, safePins.length);
  for (const [i, pin] of safes.runtimePins.entries()) {
    assert.ok(isAddressEqual(pin.address, safePins[i].address));
    assert.equal(pin.hash, safePins[i].hash);
    admittedWitnessNames(pin.witnesses);
    assert.deepEqual(corroborated(pin.witnesses, "observedHash"), { status: "CORROBORATED", value: pin.hash },
      "Safe infrastructure codehash missing or mismatched");
  }
  assert.equal(safes.proposals.length, safeProposals.proposals.length);
  for (const [i, proposal] of safes.proposals.entries()) {
    const pinned = safeProposals.proposals[i];
    for (const key of ["role", "counterfactualAddress", "create2Salt", "saltNonce", "initializerKeccak256"]) {
      assert.equal(proposal[key], pinned[key], "Safe proposal mismatch");
    }
    assert.ok(!isAddressEqual(proposal.counterfactualAddress, MOBILE_DEPLOYMENT_PAYER), "Personal payer cannot be a Safe beneficiary");
    admittedWitnessNames(proposal.vacancy);
    assert.deepEqual(destinationStatus(proposal.vacancy), { status: "VACANT", code: "0x", accountNonce: "0" },
      "Safe CREATE2 vacancy missing or mismatched");
    assert.equal(proposal.simulatedAddress, pinned.counterfactualAddress, "Safe simulation address mismatch");
    if (proposal.gas) {
      const gas = proposal.gas;
      assert.deepEqual(gas, summarizeGas({ total: BigInt(gas.nitroGasEstimate), l1: BigInt(gas.l1PosterGasUnits),
        baseFee: BigInt(gas.l2BaseFeeWei), l1BaseFee: BigInt(gas.l1BaseFeeEstimateWei), estimateGas: BigInt(gas.rpcEstimateGas) }),
      "Safe quote arithmetic mismatch");
    }
  }
  const totalWei = safes.proposals.every(({ gas }) => gas)
    ? safes.proposals.reduce((total, { gas }) => total + BigInt(gas.estimatedTotalWei), 0n) : null;
  assert.equal(safes.estimatedTotalWei, totalWei?.toString() ?? null, "Combined Safe quote mismatch");
  assert.equal(safes.budgetAtObservation, totalWei === null ? null : BigInt(sender.balanceWei) >= totalWei);
  return { ...summary, createDestinations: sender.createDestinations };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  const report = JSON.stringify(await runMobileSenderProbe(), null, 2) + "\n";
  if (values.output) writeFileSync(values.output, report, { flag: "wx" });
  else process.stdout.write(report);
}
