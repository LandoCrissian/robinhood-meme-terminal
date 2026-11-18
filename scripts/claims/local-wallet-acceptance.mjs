import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { backing, creationFee, supply } from "../../packages/contracts/scripts/fixed-supply-profile.mjs";
import { call, localFixtureClient, receiptEvidence, transact } from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { concatHex, encodeAbiParameters, encodeFunctionData, erc20Abi, isAddressEqual, keccak256, parseAbi,
  parseAbiParameters, parseEventLogs, toHex, zeroAddress } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const stringify = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
const safeAbi = parseAbi(["function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "function nonce() view returns(uint256)", "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)"]);
const safeFactoryAbi = parseAbi(["function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns(address proxy)",
  "event ProxyCreation(address indexed proxy,address singleton)"]);
const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address owner,address token,address spender) view returns(uint160,uint48,uint48)"]);
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)"]);
const positionAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function getPositionLiquidity(uint256) view returns(uint128)"]);
const routeTypes = parseAbiParameters("bytes actions,bytes[] inputs");
const swapTypes = [{ type: "tuple", components: parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData") }];
const settleTypes = parseAbiParameters("address currency,uint256 amount,bool payerIsUser"), takeTypes = parseAbiParameters("address currency,uint256 minimum");
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** Reuses the creator fixture's loopback chain, web process and sole PG writer.
 * All signers are freshly generated test keys held only by this process. */
export async function testClaimWalletProfiles({ rpcUrl, rpc, artifacts, deployed, anchor, site, workerOrigin,
  indexReadKey, out, pg, waitFor, mine, ready, restart, prepareClaimExecutionReview,
  revalidateClaimExecutionReview, verifyProductionClaimSettlement }) {
  for (const api of [prepareClaimExecutionReview, revalidateClaimExecutionReview, verifyProductionClaimSettlement]) assert.equal(typeof api, "function");
  const client = await localFixtureClient(rpcUrl, 31337);
  assert.equal(new URL(site).hostname, "127.0.0.1"); assert.equal(new URL(workerOrigin).hostname, "127.0.0.1");
  const factory = deployed.factory, engine = deployed.graduationEngine;
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV2.abi, curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
  const ledgerAbi = artifacts.RMTLaunchCurveRevenueLedgerV1.abi, lpAbi = artifacts.RMTLaunchCurveLpFeeLedgerV1.abi;
  const engineAbi = artifacts.RMTV4CurveGraduationV1.abi;
  const delegated = privateKeyToAccount(generatePrivateKey()), relayer = privateKeyToAccount(generatePrivateKey());
  const owners = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()))
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const accounts = new Map([delegated, relayer, ...owners].map(a => [a.address.toLowerCase(), a]));
  const evidence = { schemaVersion: 1, profile: "rmt-claim-wallet-acceptance-v1", chainId: 31337,
    scope: "LOCAL_SYNTHETIC_NOT_PHYSICAL_OR_PRODUCTION", productionExecution: false, status: "incomplete",
    delegatedActor: delegated.address, relayer: relayer.address, ownerAddresses: owners.map(a => a.address), receipts: [], reviews: [], checks: {} };
  const save = () => writeFileSync(join(out, "claim-wallet-acceptance.json"), stringify(evidence));
  const deadline = async () => (await client.getBlock()).timestamp + 300n;
  async function send(account, request, expected = "success") {
    assert.ok(accounts.get(account.address.toLowerCase()) === account, "Only this test process's synthetic keys can submit");
    assert.ok(!request.authorizationList && !request.accessList, "No delegation authorization or custom access list");
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    if (request.nonce !== undefined) assert.equal(BigInt(request.nonce), BigInt(nonce));
    const base = (await client.getBlock()).baseFeePerGas ?? 1n;
    const estimated = request.gas ? BigInt(request.gas) : await client.estimateGas({ account: account.address, to: request.to, data: request.data, value: BigInt(request.value ?? 0) });
    const gas = request.gas ? estimated : estimated * 125n / 100n;
    const signed = await account.signTransaction({ chainId: 31337, type: "eip1559", to: request.to, data: request.data,
      value: BigInt(request.value ?? 0), nonce, gas, maxFeePerGas: request.maxFeePerGas ? BigInt(request.maxFeePerGas) : base * 2n + 1n,
      maxPriorityFeePerGas: request.maxPriorityFeePerGas ? BigInt(request.maxPriorityFeePerGas) : 0n });
    const hash = keccak256(signed);
    assert.equal(await client.request({ method: "eth_sendRawTransaction", params: [signed] }), hash);
    const result = await client.waitForTransactionReceipt({ hash, checkReplacement: false, timeout: 30_000, pollingInterval: 100 });
    assert.equal(result.status, expected); assert.equal((await client.getBlock({ blockNumber: result.blockNumber })).hash, result.blockHash);
    const transaction = await client.getTransaction({ hash });
    assert.equal(transaction.type, "eip1559"); assert.equal(transaction.authorizationList, undefined);
    assert.ok(same(transaction.from, account.address)); assert.equal(transaction.nonce, nonce);
    evidence.receipts.push(receiptEvidence(result)); save(); return result;
  }
  async function sendReview(review, expected = "success") {
    assert.equal(review.status, "review-only"); assert.equal(review.executionEnabled, false);
    assert.equal(review.chainId, 31337); assert.ok(review.outer);
    const signer = accounts.get(review.outer.from.toLowerCase()); assert.ok(signer);
    assert.equal(review.outer.chainId, "0x7a69"); assert.equal(review.outer.value, "0x0");
    return send(signer, review.outer, expected);
  }
  function event(receipt, address, abi, eventName) {
    const logs = parseEventLogs({ abi, eventName, strict: true, logs: receipt.logs.filter(l => same(l.address, address)) });
    assert.equal(logs.length, 1, eventName); return logs[0].args;
  }
  for (const account of accounts.values()) {
    assert.ok(!(await client.getCode({ address: account.address }))); await rpc("anvil_setBalance", [account.address, toHex(20n * 10n ** 18n)]);
  }
  const runtime = JSON.parse(gunzipSync(readFileSync(new URL("../../apps/launch-website/lib/server/claim-delegate-runtime.test.json.gz", import.meta.url))));
  assert.equal(keccak256(runtime.delegate.code), runtime.delegate.runtimeHash);
  assert.equal(runtime.delegate.runtimeHash, "0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0");
  const designator = "0xef0100" + runtime.delegate.address.slice(2).toLowerCase();
  await rpc("anvil_setCode", [runtime.delegate.address, runtime.delegate.code]);
  await rpc("anvil_setCode", [delegated.address, designator]);
  evidence.delegationFixture = { implementation: runtime.delegate.address, runtimeHash: runtime.delegate.runtimeHash,
    installation: "Anvil-only designator state; existing production delegation was not modified", topLevelTransactions: "genuine synthetic-key signed type2 without authorizationList" };
  const safeRuntime = JSON.parse(readFileSync(new URL("../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json", import.meta.url)));
  for (const item of Object.values(safeRuntime.contracts)) {
    assert.equal(keccak256(item.code), item.runtimeKeccak256); await rpc("anvil_setCode", [item.address, item.code]);
  }
  const singleton = safeRuntime.contracts.safe_l2.address, safeFactory = safeRuntime.contracts.safe_proxy_factory.address;
  const handler = safeRuntime.contracts.compatibility_fallback_handler.address;
  const initializer = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [owners.map(o => o.address), 2n, zeroAddress, "0x", handler, zeroAddress, 0n, zeroAddress] });
  const setup = await send(relayer, transact(safeFactory, safeFactoryAbi, "createProxyWithNonce", [singleton, initializer, 75n]));
  const safe = event(setup, safeFactory, safeFactoryAbi, "ProxyCreation").proxy;
  evidence.safe = { address: safe, version: "1.4.1", threshold: 2, runtimeHash: keccak256(await client.getCode({ address: safe })) };
  assert.equal(evidence.safe.runtimeHash, "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c");
  assert.equal(await call(client, safe, safeAbi, "getThreshold"), 2n);
  assert.deepEqual(await call(client, safe, safeAbi, "getOwners"), owners.map(o => o.address));
  async function createProject(number, creatorAccount = delegated) {
    const receipt = await send(creatorAccount, { ...transact(factory, factoryAbi, "create", ["Wallet profile " + number, "WP" + number,
      "https://example.test/claim-profile-" + number, safe, 2250, toHex(number, { size: 32 }), await deadline()]), value: creationFee });
    const birth = event(receipt, factory, factoryAbi, "CurveCreated");
    assert.ok(same(birth.creator, creatorAccount.address)); assert.equal(birth.supply, supply);
    const [tokens] = await call(client, birth.curve, curveAbi, "quoteBuy", [10n ** 17n]);
    await send(creatorAccount, { ...transact(birth.curve, curveAbi, "buy", [tokens, await deadline()]), value: 10n ** 17n });
    return { token: birth.token, curve: birth.curve, revenueLedger: birth.revenueLedger, creation: receiptEvidence(receipt) };
  }
  const projects = [await createProject(7501), await createProject(7502), await createProject(7503, relayer)]; evidence.projects = projects; await mine(); await ready();
  async function birthFor(project, beneficiary = delegated.address) {
    const url = new URL("/earnings", workerOrigin); url.searchParams.set("recipient", beneficiary); url.searchParams.set("token", project.token); url.searchParams.set("limit", "1");
    return waitFor("canonical beneficiary registration after checkpoint reconciliation", async () => {
      const response = await fetch(url, { headers: { "X-RMT-Fixture-Key": indexReadKey }, signal: AbortSignal.timeout(10_000) });
      if (response.status === 503) return null; // A transient checkpoint is unavailable, never an invented registration.
      assert.equal(response.status, 200); const d = await response.json(); assert.equal(d.status, "ready"); assert.equal(d.launches.length, 1);
      assert.ok(same(d.launches[0].token, project.token));
      return { registration: d.launches[0], checkpoint: d.checkpoint };
    });
  }
  async function context(project, beneficiary = delegated.address, rpcView = client) {
    const { registration, checkpoint } = await birthFor(project, beneficiary);
    return { registration, context: { chainId: 31337, rpc: rpcView, factory, factoryRuntimeHash: deployed.factoryRuntimeHash,
      registry: deployed.projectRegistry, registryRuntimeHash: deployed.registryRuntimeHash, deploymentBlock: BigInt(deployed.deployBlock), deploymentBlockHash: deployed.deployment.blockHash,
      checkpoint, graduation: { address: engine, runtimeHash: deployed.graduationRuntimeHash, guard: deployed.guard, guardRuntimeHash: deployed.guardRuntimeHash },
      poolManager: { address: anchor.poolManager.address, runtimeHash: anchor.poolManager.runtimeHash },
      positionManager: { address: anchor.positionManager.address, runtimeHash: anchor.positionManager.runtimeHash } } };
  }
  async function prepare(project, kind, operation, options = {}) {
    const beneficiary = options.beneficiary ?? (kind === "safe-1.4.1" ? safe : delegated.address);
    const binding = await context(project, beneficiary);
    return prepareClaimExecutionReview({ ...binding, operation, kind, account: kind === "safe-1.4.1" || kind === "eoa" ? relayer.address : delegated.address,
      beneficiary, ...(kind === "safe-1.4.1" && { safeAddress: safe }), ...options });
  }
  const signSafeReview = async (review, count = 2) => {
    assert.equal(review.kind, "safe-1.4.1"); assert.ok(same(review.actor, safe)); assert.ok([1, 2].includes(count));
    const digest = review.wallet.safe.transactionHash;
    return concatHex(await Promise.all(owners.slice(0, count).map(owner => owner.sign({ hash: digest }))));
  };
  async function safeReview(project, operation) {
    const proposal = await prepare(project, "safe-1.4.1", operation);
    assert.equal(proposal.status, "awaiting-safe-approvals"); assert.equal(proposal.outer, null);
    const result = await prepare(project, "safe-1.4.1", operation, { safeSignatures: await signSafeReview(proposal) });
    assert.equal(result.status, "review-only", stringify(result)); assert.equal(result.wallet.safe.transactionHash, proposal.wallet.safe.transactionHash);
    return result;
  }
  async function indexed(activity, checkpoint) {
    const result = await pg.query(`SELECT chain_id,factory,deployment_block_hash,token,ledger,account,recipient,block_number::text,block_hash,transaction_hash,log_index,payload
      FROM rmt_curve_fixture_fee_activity WHERE chain_id=31337 AND factory=$1 AND transaction_hash=$2 AND log_index=$3`, [factory.toLowerCase(), activity.transactionHash.toLowerCase(), activity.logIndex]);
    if (result.rows.length !== 1) return null; const r = result.rows[0];
    const kind = activity.operation.startsWith("lp-claim") ? "lp-claim" : activity.operation === "creation-fees" ? "creation-payout" : activity.operation;
    if (!same(r.deployment_block_hash, deployed.deployment.blockHash) || !same(r.ledger, activity.ledger) || !same(r.account, activity.actor)
      || !same(r.recipient, activity.beneficiary) || !same(r.block_hash, activity.blockHash) || r.block_number !== activity.blockNumber || r.payload.kind !== kind
      || r.payload.nativeWei !== activity.nativeWei || r.payload.tokenWei !== activity.tokenWei || (activity.token === null ? r.token !== null : !same(r.token, activity.token))) return null;
    return { schemaVersion: 1, status: "canonical", activity, checkpoint };
  }
  async function verify(project, review, hash, options = {}) {
    const binding = await context(project, review.inner.discoveryRecipient);
    const a = { id: "local-a-synthetic", context: binding.context }, b = { id: "local-b-synthetic", context: { ...binding.context, rpc: options.rpcB ?? client } };
    const { rpcB: _ignored, ...rest } = options;
    return verifyProductionClaimSettlement({ contexts: [a, b], registration: binding.registration, review,
      ...(hash && { transactionHash: hash }), indexed, ...rest });
  }
  async function settle(project, review, receipt) {
    await mine(); await ready();
    const result = await verify(project, review, receipt.transactionHash);
    assert.equal(result.stage, "canonical-l2", stringify(result)); assert.equal(result.indexed, true);
    const settled = await verify(project, review, receipt.transactionHash, { finalityPolicy: { kind: "synthetic-local-v1", chainId: 31337, checkpointBlockHash: result.canonicalAt.blockHash } });
    assert.equal(settled.stage, "settled"); assert.equal(settled.finality.l1Finality, "not-applicable");
    evidence.reviews.push({ review, receipt: receiptEvidence(receipt), verification: settled }); save(); return settled;
  }
  try {
    const first = projects[0], second = projects[1];
    const eoaReview = await prepare(projects[2], "eoa", "curve-claim", { beneficiary: relayer.address });
    assert.equal(eoaReview.status, "review-only", stringify(eoaReview));
    await settle(projects[2], eoaReview, await sendReview(eoaReview));
    evidence.checks.directEoaBeneficiaryClaim = true;
    const directA = await prepare(first, "metamask-7702", "curve-claim"), directB = await prepare(second, "metamask-7702", "curve-claim");
    assert.equal(directA.status, "review-only", stringify(directA)); assert.equal(directB.status, "review-only", stringify(directB));
    assert.equal(directA.outer.nonce, directB.outer.nonce);
    const codeSnapshot = await rpc("evm_snapshot");
    for (const code of ["0x", "0xef0100" + "7b".repeat(20)]) {
      await rpc("anvil_setCode", [delegated.address, code]);
      const binding = await context(first);
      const changed = await revalidateClaimExecutionReview(binding.context, binding.registration, directA);
      assert.equal(changed.status, "unavailable", "Revoked/replaced delegation invalidates the original review");
    }
    assert.equal(await rpc("evm_revert", [codeSnapshot]), true);
    assert.equal(await client.getCode({ address: delegated.address }), designator);
    evidence.checks.delegationRevokedOrReplacedRejected = true;
    const directReceipt = await sendReview(directA); await settle(first, directA, directReceipt);
    const staleBinding = await context(second);
    assert.equal((await revalidateClaimExecutionReview(staleBinding.context, staleBinding.registration, directB)).status, "unavailable", "A concurrent second-token review cannot silently change its nonce");
    const freshB = await prepare(second, "metamask-7702", "curve-claim"); await settle(second, freshB, await sendReview(freshB));
    evidence.checks.multiTokenNonceConflictRequiresFreshReview = true;
    const proposal = await prepare(first, "safe-1.4.1", "curve-claim");
    const oneSignature = await signSafeReview(proposal, 1);
    const rejectedPreparation = await prepare(first, "safe-1.4.1", "curve-claim", { safeSignatures: oneSignature });
    assert.equal(rejectedPreparation.status, "unavailable");
    const tx = proposal.wallet.safe.transaction;
    const oneOwnerCall = encodeFunctionData({ abi: safeAbi, functionName: "execTransaction", args: [tx.to, 0n, tx.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, oneSignature] });
    const safeNonce = await call(client, safe, safeAbi, "nonce");
    evidence.oneOwnerRejection = receiptEvidence(await send(relayer, { to: safe, data: oneOwnerCall, gas: 400000n }, "reverted"));
    assert.equal(await call(client, safe, safeAbi, "nonce"), safeNonce);
    await mine(); await ready(); // The reverted outer transaction still consumed its gas payer's EVM nonce.
    const approved = await safeReview(first, "curve-claim"); const safeReceipt = await sendReview(approved); await settle(first, approved, safeReceipt);
    const replay = await send(relayer, { ...approved.outer, nonce: undefined, gas: approved.outer.gas }, "reverted");
    evidence.safeReplayRejection = receiptEvidence(replay); evidence.checks.safeTwoOwnerExecutionAndOneOwnerRejection = true;
    await mine(); await ready();

    const [tokens] = await call(client, first.curve, curveAbi, "quoteBuy", [3n * 10n ** 18n]);
    await send(delegated, { ...transact(first.curve, curveAbi, "buy", [tokens, await deadline()]), value: 3n * 10n ** 18n });
    assert.equal(await call(client, first.curve, curveAbi, "backingReserve"), backing);
    const graduated = await send(delegated, transact(first.curve, curveAbi, "graduate", [await deadline()]));
    const position = event(graduated, engine, engineAbi, "CurveGraduated"); evidence.graduation = { ...position, receipt: receiptEvidence(graduated) };
    const custody = async () => { assert.equal(await call(client, anchor.positionManager.address, positionAbi, "ownerOf", [position.positionTokenId]), engine);
      assert.equal(await call(client, anchor.positionManager.address, positionAbi, "getPositionLiquidity", [position.positionTokenId]), position.liquidity); };
    const key = await call(client, engine, engineAbi, "canonicalPoolKey", [first.token]);
    async function swap(buy, amount, expiry) {
      const quote = await client.simulateContract({ account: delegated.address, address: anchor.quoter.address, abi: quoterAbi,
        functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: buy, exactAmount: amount, hookData: "0x" }] });
      const minimum = quote.result[0] * 99n / 100n; assert.ok(minimum > 0n);
      const route = encodeAbiParameters(routeTypes, ["0x060b0f", [encodeAbiParameters(swapTypes, [{ poolKey: key, zeroForOne: buy, amountIn: amount,
        amountOutMinimum: minimum, minHopPriceX36: minimum * 10n ** 36n / amount, hookData: "0x" }]),
      encodeAbiParameters(settleTypes, [buy ? key.currency0 : key.currency1, amount, true]), encodeAbiParameters(takeTypes, [buy ? key.currency1 : key.currency0, minimum])]]);
      return send(delegated, { ...transact(anchor.universalRouter212.address, routerAbi, "execute", ["0x10", [route], expiry ?? await deadline()]), value: buy ? amount : 0n });
    }
    await swap(true, 10n ** 16n); const sellAmount = 100n * 10n ** 18n, sellExpiry = await deadline();
    await send(delegated, transact(first.token, erc20Abi, "approve", [anchor.permit2.address, sellAmount]));
    await send(delegated, transact(anchor.permit2.address, permitAbi, "approve", [first.token, anchor.universalRouter212.address, sellAmount, Number(sellExpiry)]));
    await swap(false, sellAmount, sellExpiry);
    assert.equal(await call(client, first.token, erc20Abi, "allowance", [delegated.address, anchor.permit2.address]), 0n);
    await mine(); await ready();
    const collection = await prepare(first, "eoa", "lp-collect"); await settle(first, collection, await sendReview(collection)); await custody();
    const lpLedger = await call(client, engine, engineAbi, "lpFeeLedger", [first.token]);
    const before = await call(client, lpLedger, lpAbi, "claimable", [delegated.address]); assert.ok(before[0] > 0n && before[1] > 0n);
    const nativeReview = await prepare(first, "metamask-7702", "lp-claim-native"); const nativeReceipt = await sendReview(nativeReview);
    await mine(); await ready();
    const noTrace = { ...client, request: async (request, options) => { if (request.method === "debug_traceTransaction") throw Error("Synthetic trace outage"); return client.request(request, options); } };
    const pending = await verify(first, nativeReview, nativeReceipt.transactionHash, { rpcB: noTrace });
    assert.notEqual(pending.stage, "settled"); assert.notEqual(pending.stage, "canonical-l2");
    const missingHash = await verify(first, nativeReview, undefined); assert.ok(same(missingHash.transactionHash, nativeReceipt.transactionHash));
    await settle(first, nativeReview, nativeReceipt);
    const wrongReceipt = { ...client, getTransactionReceipt: async input => ({ ...await client.getTransactionReceipt(input), blockHash: toHex(919n, { size: 32 }) }) };
    const disagreement = await verify(first, nativeReview, nativeReceipt.transactionHash, { rpcB: wrongReceipt }); assert.equal(disagreement.stage, "unavailable");
    evidence.checks.missingHashRecoveredWithoutSend = true; evidence.checks.missingTraceAndDisagreementFailClosed = true;
    const remaining = await call(client, lpLedger, lpAbi, "claimable", [delegated.address]); assert.equal(remaining[0], 0n); assert.equal(remaining[1], before[1]);
    const tokenReview = await prepare(first, "metamask-7702", "lp-claim-token"); const snapshot = await rpc("evm_snapshot");
    const tokenReceipt = await sendReview(tokenReview); await settle(first, tokenReview, tokenReceipt);
    const safeLp = await safeReview(first, "lp-claim"); await settle(first, safeLp, await sendReview(safeLp)); await custody();
    await restart();
    assert.equal((await verify(first, tokenReview, tokenReceipt.transactionHash)).stage, "canonical-l2");
    assert.equal(await rpc("evm_revert", [snapshot]), true); await rpc("evm_increaseTime", [73]); await mine();
    await waitFor("orphaned claim activity removed from durable store", async () =>
      (await pg.query("SELECT count(*)::int AS n FROM rmt_curve_fixture_fee_activity WHERE transaction_hash=$1", [tokenReceipt.transactionHash.toLowerCase()])).rows[0].n === 0);
    await ready();
    const orphan = await verify(first, tokenReview, tokenReceipt.transactionHash);
    assert.ok(["submitted", "unavailable"].includes(orphan.stage), stringify(orphan)); assert.notEqual(orphan.indexed, true);
    const restored = await call(client, lpLedger, lpAbi, "claimable", [delegated.address]); assert.deepEqual(restored, remaining); await custody();
    const orphanRows = await pg.query("SELECT count(*)::int AS n FROM rmt_curve_fixture_fee_activity WHERE transaction_hash=$1", [tokenReceipt.transactionHash.toLowerCase()]);
    assert.equal(orphanRows.rows[0].n, 0);
    evidence.checks.restartAndReorgRestoredCredits = true; evidence.checks.principalUnchanged = true;
    const factoryDue = await call(client, factory, factoryAbi, "creationFeesAccrued");
    const operations = deployed.deployment.operatingRecipient;
    const operationsBefore = await client.getBalance({ address: operations });
    const factoryReview = await prepare(first, "eoa", "creation-fees");
    assert.equal(factoryReview.beneficiary, operations);
    await settle(first, factoryReview, await sendReview(factoryReview));
    assert.equal(await client.getBalance({ address: operations }) - operationsBefore, factoryDue);
    evidence.checks.creationFeesPaidOnlyToImmutableOperations = true;
    evidence.checks.productionFinalityNotClaimed = true; evidence.status = "passed"; save();
    return { evidence, actors: { delegated: delegated.address, relayer: relayer.address, safe, owners: owners.map(o => o.address) }, projects,
      signSafeReview, sendReviewedTransaction: async envelope => send(accounts.get(envelope.from.toLowerCase()), envelope), client };
  } catch (error) { evidence.failure = error instanceof Error ? error.message : "Acceptance failed"; save(); throw error; }
}
