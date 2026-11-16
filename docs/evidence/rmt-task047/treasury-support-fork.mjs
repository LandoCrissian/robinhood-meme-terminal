import assert from "node:assert/strict";
import { createRequire } from "node:module";
// The pinned fork runner copies this module beside the fixture's Safe utility.
import { setupFixtureSafe } from "./safe-rehearsal.mjs";
import { reviewTreasurySupport } from "./treasury-support.mjs";

const viem = createRequire(new URL("../../../apps/web/package.json", import.meta.url))("viem");
const { erc20Abi, getAddress, parseEventLogs } = viem;
const scope = "SYNTHETIC_4663_FORK";
const lammbPayee = getAddress("0x0000000000000000000000000000000046630050");
const rmtPayee = getAddress("0x0000000000000000000000000000000046630051");

export async function verifySupportFixture({ client, send, collector, platform, projectAsset, protectedState }) {
  const [operations, reserve] = platform.map(({ safe }) => safe);
  const lammb = await setupFixtureSafe({
    client, sender: collector, saltNonce: 3n, submit: (from, call, expected) => send(client, from, call, expected),
  });
  assert.ok(lammb.setup.ownerAddresses.every((owner) => !operations.setup.ownerAddresses.includes(owner)));
  const funding = await send(client, collector, { to: lammb.address, data: "0x", value: 200_000_000_000_000n });
  const fundingBefore = await client.getBalance({ address: lammb.address });
  assert.equal(fundingBefore, 200_000_000_000_000n);
  const bindings = {
    chainId: 4663, operations: operations.address, reserve: reserve.address,
    lammbTreasury: lammb.address, lammbSupportPayee: lammbPayee, rmtSupportPayee: rmtPayee,
    projectToken: projectAsset,
  };
  const balance = (asset, address) => asset === "ETH"
    ? client.getBalance({ address })
    : client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  const policyBefore = await protectedState();
  const plans = [
    { direction: "RMT_SUPPORTS_LAMMB", approvedBy: "RMT_OPERATIONS", safe: operations, other: lammb, recipient: lammbPayee,
      asset: projectAsset, amount: 100n, reference: "fixture-lammb-project-expense" },
    { direction: "LAMMB_SUPPORTS_RMT", approvedBy: "LAMMB_TREASURY", safe: lammb, other: operations, recipient: rmtPayee,
      asset: "ETH", amount: 50_000_000_000_000n, reference: "fixture-rmt-project-expense" },
  ];
  const results = [];
  for (const { direction, approvedBy, safe, other, recipient, asset, amount, reference } of plans) {
    const state = await safe.state();
    const senderBefore = await balance(asset, safe.address);
    const recipientBefore = await balance(asset, recipient);
    const otherBefore = await other.state();
    const otherBalances = await Promise.all([balance("ETH", other.address), balance(projectAsset, other.address)]);
    const intent = {
      reference, chainId: 4663, direction, from: safe.address, recipient, asset,
      amount: amount.toString(), nonce: state.nonce.toString(),
    };
    const approval = { scope, approvedBy, intent };
    const observed = { chainId: 4663, safe: safe.address, nonce: state.nonce, available: senderBefore };
    const review = reviewTreasurySupport(viem, { scope, bindings, request: intent, approval, observed });
    assert.equal(review.broadcastAuthorized, false);
    const { to, value, data } = review.transaction;
    const call = { to, value, data };
    const insufficient = await safe.rejectInsufficient(call);
    const execution = await safe.execute(call);
    const replay = await safe.rejectReplay(execution);
    assert.equal(execution.safeTxHash, review.safeTxHash, "Unsigned digest must match the actual Safe");
    assert.equal(await balance(asset, safe.address), senderBefore - amount);
    assert.equal(await balance(asset, recipient), recipientBefore + amount);
    if (asset !== "ETH") {
      const events = parseEventLogs({ abi: erc20Abi, eventName: "Transfer",
        logs: execution.receipt.logs.filter(({ address }) => getAddress(address) === asset), strict: true });
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].args, { from: safe.address, to: recipient, value: amount });
    }
    assert.deepEqual(await protectedState(), policyBefore, "Spending touched Reserve, project credits or LP principal");
    assert.deepEqual(await other.state(), otherBefore);
    assert.deepEqual(await Promise.all([balance("ETH", other.address), balance(projectAsset, other.address)]), otherBalances);
    const { transactionHash, blockHash, blockNumber, gasUsed } = execution.receipt;
    results.push({
      review, transactionHash, blockHash, blockNumber, gasUsed, nativeOrTokenDelta: amount,
      otherTreasuryUnaffected: true, protectedStateUnchanged: true,
      safeAttribution: execution.attribution, rejects: { insufficient, replay },
    });
  }
  return {
    scope, lammbTreasuryFixture: lammb.setup,
    syntheticFunding: { transactionHash: funding.transactionHash, amount: fundingBefore },
    payments: results, protectedState: policyBefore,
  };
}
