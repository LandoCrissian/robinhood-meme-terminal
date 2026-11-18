import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { backing, creationFee, supply } from "../../packages/contracts/scripts/fixed-supply-profile.mjs";
import { call, localFixtureClient, receiptEvidence, sendFixture, transact }
  from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
import { proveFundedMigrations } from "../../packages/contracts/scripts/prove-fixed-supply-funded-migrations.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, erc20Abi, isAddressEqual, keccak256, parseAbi, parseAbiParameters, parseEventLogs, toHex } = require("viem");
const routeType = parseAbiParameters("bytes actions,bytes[] inputs");
const swapType = [{ type: "tuple", components: parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData") }];
const settleType = parseAbiParameters("address currency,uint256 amount,bool payerIsUser"), takeType = parseAbiParameters("address currency,uint256 minimum");
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)", "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)"]);
const quoteAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
const positionAbi = parseAbi(["function ownerOf(uint256) view returns (address)", "function getPositionLiquidity(uint256) view returns (uint128)"]);
const stringify = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);

/** Supplemental contract/indexer/API acceptance. Reuses the parent's existing
 * isolated processes. These operator receipts are separate from its 24 browser
 * confirmations; this helper never controls a production wallet or new server. */
export async function testSuccessorEarningsJourney({ rpcUrl, rpc, artifacts, deployed, anchor, creator, treasury, operator,
  operations, reserve, site, out, pg, waitFor, mine, ready, restart }) {
  const client = await localFixtureClient(rpcUrl, 31337);
  assert.equal(new URL(site).hostname, "127.0.0.1");
  assert.equal(new URL(site).protocol, "http:");
  assert.equal(typeof deployed.scheduleFixtureMigration, "function", "Enable only the existing fixture governance closure");
  const factory = deployed.factory, engine = deployed.graduationEngine;
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV2.abi, curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
  const engineAbi = artifacts.RMTV4CurveGraduationV1.abi, curveLedgerAbi = artifacts.RMTLaunchCurveRevenueLedgerV1.abi;
  const lpAbi = artifacts.RMTLaunchCurveLpFeeLedgerV1.abi;
  const evidence = { chainId: 31337, synthetic: true, scope: "supplemental-fixture-operator-not-browser-acceptance",
    factory, projectRegistry: deployed.projectRegistry, receipts: [], productionExecution: "disabled", status: "incomplete" };
  const save = () => writeFile(join(out, "successor-earnings-evidence.json"), stringify(evidence) + "\n");
  const deadline = async () => (await client.getBlock()).timestamp + 300n;
  const submit = async (from, request, expected) => {
    const receipt = await sendFixture(client, from, request, expected);
    evidence.receipts.push(receiptEvidence(receipt)); return receipt;
  };
  const event = (receipt, address, abi, name) => {
    const rows = parseEventLogs({ abi, eventName: name, strict: true,
      logs: receipt.logs.filter(log => isAddressEqual(log.address, address)) });
    assert.equal(rows.length, 1, name); return rows[0].args;
  };
  const getSnapshot = async token => {
    const response = await fetch(`${site}/api/launchpad/earnings/${token}?recipient=${creator}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const body = await response.json();
    return body.status === "ready" && body.snapshot?.status === "ready" ? body.snapshot : null;
  };
  const post = async body => {
    const response = await fetch(`${site}/api/launchpad/test-earnings`, { method: "POST", headers: { Origin: site, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
    const result = await response.json(); assert.equal(response.status, 200, stringify(result)); return result;
  };
  const claim = async (token, operation, account) => {
    const prepared = await post({ action: "prepare", token, operation, account, beneficiary: creator });
    assert.equal(prepared.status, "prepared", stringify(prepared));
    const request = prepared.request;
    assert.equal(request.chainId, "0x7a69"); assert.ok(isAddressEqual(request.from, account));
    assert.equal(request.operation, operation);
    assert.equal(BigInt(request.nonce), BigInt(await client.getTransactionCount({ address: account, blockTag: "pending" })));
    const receipt = await submit(account, { to: request.to, data: request.data, value: 0n });
    await mine(); await ready();
    const verified = await post({ action: "verify", request, transactionHash: receipt.transactionHash });
    assert.equal(verified.status, "confirmed", stringify(verified)); assert.equal(verified.indexed, true);
    return { request, verification: verified, receipt: receiptEvidence(receipt) };
  };
  const actors = [...new Set([creator, operator].map(address => address.toLowerCase()))];
  try {
    for (const address of actors) {
      assert.equal(await client.getCode({ address }) ?? "0x", "0x", "Only the parent's synthetic EOA fixtures are admitted");
      await rpc("anvil_setBalance", [address, toHex(20n * 10n ** 18n)]);
      await rpc("anvil_impersonateAccount", [address]);
    }
    const created = await submit(creator, { ...transact(factory, factoryAbi, "create", ["Successor earnings", "NEXT", "https://example.test/successor-earnings",
      treasury, 2250, keccak256(toHex("rmt-task074-successor-earnings")), await deadline()]), value: creationFee });
    const birth = event(created, factory, factoryAbi, "CurveCreated");
    const { token, curve: originalCurve, revenueLedger } = birth;
    Object.assign(evidence, { token, creator, treasury, originalCurve, originalCurveLedger: revenueLedger, creation: receiptEvidence(created) });
    await save();
    const [openingTokens] = await call(client, originalCurve, curveAbi, "quoteBuy", [5n * 10n ** 17n]);
    await submit(creator, { ...transact(originalCurve, curveAbi, "buy", [openingTokens, await deadline()]), value: 5n * 10n ** 17n });
    const migrated = await proveFundedMigrations(client, artifacts, deployed, submit, transact,
      { token, curve: originalCurve, creator, revenueLedger, beneficiaries: [creator, treasury, operations, reserve] });
    evidence.migrations = migrated.transitions;
    await save();
    const successor = migrated.curve;
    assert.equal(migrated.transitions.length, 2);
    assert.equal(await call(client, successor, curveAbi, "revenueLedger"), revenueLedger);
    assert.equal(await call(client, revenueLedger, curveLedgerAbi, "activeCurve"), successor);
    const [closingTokens] = await call(client, successor, curveAbi, "quoteBuy", [3n * 10n ** 18n]);
    await submit(creator, { ...transact(successor, curveAbi, "buy", [closingTokens, await deadline()]), value: 3n * 10n ** 18n });
    assert.equal(await call(client, successor, curveAbi, "backingReserve"), backing);
    assert.equal(await call(client, token, erc20Abi, "totalSupply"), supply);
    await mine(); await ready();
    const migratedSnapshot = await waitFor("successor original-ledger earnings", () => getSnapshot(token));
    assert.equal(migratedSnapshot.engineVersion, 3);
    assert.ok(isAddressEqual(migratedSnapshot.curve.ledger, revenueLedger));
    assert.ok(BigInt(migratedSnapshot.curve.claimableNativeWei) > 0n);
    evidence.migratedSnapshot = migratedSnapshot;
    evidence.curveClaim = await claim(token, "curve-claim", creator);
    await save();
    assert.ok(isAddressEqual(evidence.curveClaim.request.to, revenueLedger), "Migration never redirects the original ledger claim");

    const graduated = await submit(creator, transact(successor, curveAbi, "graduate", [await deadline()]));
    const position = event(graduated, engine, engineAbi, "CurveGraduated");
    assert.ok(isAddressEqual(position.curve, successor));
    evidence.graduation = { ...position, receipt: receiptEvidence(graduated) };
    await save();
    const custody = async () => {
      assert.ok(isAddressEqual(await call(client, anchor.positionManager.address, positionAbi, "ownerOf", [position.positionTokenId]), engine));
      assert.equal(await call(client, anchor.positionManager.address, positionAbi, "getPositionLiquidity", [position.positionTokenId]), position.liquidity);
    };
    await custody();
    const key = await call(client, engine, engineAbi, "canonicalPoolKey", [token]);
    const swap = async (buy, amount) => {
      const params = { poolKey: key, zeroForOne: buy, exactAmount: amount, hookData: "0x" };
      const quoted = await client.simulateContract({ account: creator, address: anchor.quoter.address, abi: quoteAbi, functionName: "quoteExactInputSingle", args: [params] });
      const minimum = quoted.result[0] * 99n / 100n; assert.ok(minimum > 0n);
      const minHopPriceX36 = minimum * 10n ** 36n / amount; assert.ok(minHopPriceX36 > 0n);
      const encodedSwap = encodeAbiParameters(swapType, [{ poolKey: key, zeroForOne: buy, amountIn: amount, amountOutMinimum: minimum, minHopPriceX36, hookData: "0x" }]);
      const [input, output] = buy ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
      const routes = encodeAbiParameters(routeType, ["0x060b0f", [encodedSwap, encodeAbiParameters(settleType, [input, amount, true]), encodeAbiParameters(takeType, [output, minimum])]]);
      const request = { ...transact(anchor.universalRouter212.address, routerAbi, "execute", ["0x10", [routes], await deadline()]), value: buy ? amount : 0n };
      await client.call({ account: creator, ...request });
      return submit(creator, request);
    };
    evidence.v4Buy = receiptEvidence(await swap(true, 10n ** 16n));
    const sellAmount = 100n * 10n ** 18n;
    await submit(creator, transact(token, erc20Abi, "approve", [anchor.permit2.address, sellAmount]));
    await submit(creator, transact(anchor.permit2.address, permitAbi, "approve", [token, anchor.universalRouter212.address, sellAmount, Number(await deadline())]));
    evidence.v4Sell = receiptEvidence(await swap(false, sellAmount));
    assert.equal(await call(client, token, erc20Abi, "allowance", [creator, anchor.permit2.address]), 0n);
    assert.equal((await call(client, anchor.permit2.address, permitAbi, "allowance", [creator, token, anchor.universalRouter212.address]))[0], 0n);
    await mine(); await ready();
    const preCollection = await waitFor("successor locked LP earnings", async () => {
      const s = await getSnapshot(token); return s?.lp.status === "ready" ? s : null;
    });
    assert.equal(preCollection.engineVersion, 3);
    assert.ok(BigInt(preCollection.lp.uncollectedNativeWei) > 0n && BigInt(preCollection.lp.uncollectedTokenWei) > 0n);
    evidence.collection = await claim(token, "lp-collect", operator);
    await save();
    const beforeClaim = await waitFor("successor collected LP credits", async () => {
      const s = await getSnapshot(token); return s?.lp.status === "ready" && BigInt(s.lp.claimableNativeWei) > 0n && BigInt(s.lp.claimableTokenWei) > 0n ? s : null;
    });
    const claimSnapshot = await rpc("evm_snapshot");
    evidence.lpClaim = await claim(token, "lp-claim", creator);
    await save();
    await custody();
    const paid = await getSnapshot(token);
    assert.equal(paid.lp.claimableNativeWei, "0"); assert.equal(paid.lp.claimableTokenWei, "0");
    const rows = (await pg.query("SELECT token,ledger,account,recipient,transaction_hash,block_hash,log_index,payload FROM rmt_curve_fixture_fee_activity WHERE lower(token)=lower($1) ORDER BY block_number,log_index", [token])).rows;
    for (const proof of [evidence.curveClaim, evidence.collection, evidence.lpClaim]) {
      assert.equal(rows.filter(row => row.transaction_hash.toLowerCase() === proof.receipt.transactionHash.toLowerCase()).length, 1);
    }
    evidence.indexedRows = rows;
    await restart();
    const restored = await getSnapshot(token);
    assert.equal(restored.engineVersion, 3); assert.equal(restored.lp.claimedNativeWei, paid.lp.claimedNativeWei);
    assert.equal(restored.lp.claimedTokenWei, paid.lp.claimedTokenWei);
    evidence.restartVerified = true;
    assert.equal(await rpc("evm_revert", [claimSnapshot]), true);
    await rpc("evm_increaseTime", [73]); await mine();
    await waitFor("successor LP claim rollback", async () => (await pg.query("SELECT count(*)::int AS n FROM rmt_curve_fixture_fee_activity WHERE transaction_hash=$1", [evidence.lpClaim.receipt.transactionHash.toLowerCase()])).rows[0].n === 0);
    await ready();
    const rolledBack = await getSnapshot(token);
    assert.equal(rolledBack.lp.claimableNativeWei, beforeClaim.lp.claimableNativeWei);
    assert.equal(rolledBack.lp.claimableTokenWei, beforeClaim.lp.claimableTokenWei);
    assert.equal(await rpc("eth_getTransactionReceipt", [evidence.lpClaim.receipt.transactionHash]), null);
    await custody();
    evidence.claimReorgRestoredCredits = true;
    evidence.principalUnchanged = true;
    evidence.beforeClaim = beforeClaim; evidence.afterClaim = paid; evidence.afterClaimReorg = rolledBack;
    evidence.status = "passed";
    await save();
    return evidence;
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : "Supplemental fixture failed";
    await save();
    throw error;
  } finally {
    for (const address of actors) await rpc("anvil_stopImpersonatingAccount", [address]);
  }
}
