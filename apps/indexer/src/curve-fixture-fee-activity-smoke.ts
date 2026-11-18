import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { indexFixtureFeeActivity, fixtureLpFeeActivity } from "./curve-fixture-fee-activity.js";
import type { FixtureTx } from "./curve-fixture-lifecycle.js";
import { syntheticProductionConfig, syntheticProductionRegistration } from "./curve-production-smoke.js";

const account = (id: number): Address => `0x${((1n << 156n) + BigInt(id)).toString(16).padStart(40, "0")}`;
const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;
const abi = parseAbi(["function claim()", "function claimCreationFees()", "event CurveFeeClaimed(address indexed recipient,uint256 amount)",
  "event CreationFeesClaimed(address indexed recipient,uint256 amount)"]);
const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns(bool)"]);
const claim = encodeFunctionData({ abi, functionName: "claim" });
const payout = encodeFunctionData({ abi, functionName: "claimCreationFees" });

export async function testFixtureFeeActivity() {
  const binding = { ...syntheticProductionConfig.binding, chainId: 31337 as const };
  const launch = { ...syntheticProductionRegistration(), chainId: 31337 as const };
  const cursor = { launch, grossFees: 0n };
  const block = { blockNumber: "200", blockHash: hash(200), timestamp: "2026-11-18T12:00:00.000Z" };
  let recipient = launch.creator, amount = 10n, after = 0n, rejected = false, missingTrace = false, badRecipient = false;
  let safe = false, factory = false, emitted = true;
  const safeWallet = account(500);
  const tx = (): FixtureTx => ({ hash: hash(201), chainId: 31337, from: launch.creator,
    to: factory ? binding.factory : safe ? safeWallet : launch.revenueLedger,
    input: factory ? payout : safe ? encodeFunctionData({ abi: safeAbi, functionName: "execTransaction",
      args: [launch.revenueLedger, 0n, claim, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"] }) : claim,
    value: 0n, blockHash: block.blockHash, blockNumber: 200n, transactionIndex: 0 });
  const rpc = {
    async getTransactionReceipt() {
      const transaction = tx();
      return { status: rejected ? "reverted" : "success", from: transaction.from, to: transaction.to,
        transactionHash: transaction.hash, blockNumber: 200n, blockHash: block.blockHash, transactionIndex: 0,
        logs: emitted ? [{ address: factory ? binding.factory : launch.revenueLedger, blockNumber: 200n,
          blockHash: block.blockHash, transactionHash: transaction.hash, transactionIndex: 0, removed: false, logIndex: 4,
          topics: encodeEventTopics({ abi, eventName: factory ? "CreationFeesClaimed" : "CurveFeeClaimed",
            args: { recipient: badRecipient ? account(999) : factory ? binding.creationFeeRecipient : recipient } }),
          data: encodeAbiParameters([{ type: "uint256" }], [amount]) }] : [] };
    },
    async readContract({ blockNumber }: { blockNumber: bigint }) { return blockNumber === 199n ? 10n : after; },
    async request() {
      if (missingTrace) throw new Error("Synthetic missing trace");
      const transaction = tx();
      const ledger = factory ? binding.factory : launch.revenueLedger;
      const target = factory ? binding.creationFeeRecipient : recipient;
      const payment = { type: "CALL", from: ledger, to: target, value: "0xa", input: "0x", calls: [] };
      const inner = { type: "CALL", from: safeWallet, to: ledger, value: "0x0", input: claim, calls: [payment] };
      return { type: "CALL", from: transaction.from, to: transaction.to, value: "0x0", input: transaction.input,
        calls: safe ? [inner] : [payment] };
    },
  } as unknown as PublicClient;
  const read = () => indexFixtureFeeActivity(rpc, binding, [cursor], tx(), block, 0);
  const first = await read();
  assert.equal(first?.kind, "curve-claim"); assert.equal(first?.recipient, launch.creator); assert.equal(first?.nativeWei, "10");
  missingTrace = true; await assert.rejects(read(), /missing trace/); missingTrace = false;
  badRecipient = true; await assert.rejects(read(), /settlement proof/); badRecipient = false;
  amount = 11n; await assert.rejects(read(), /settlement proof/); amount = 10n;
  after = 1n; await assert.rejects(read(), /settlement proof/); after = 0n;
  rejected = true; await assert.rejects(read(), /settlement proof/); emitted = false;
  assert.equal(await read(), undefined, "Reverts never become indexed successful claims");
  rejected = false; emitted = true;
  safe = true; recipient = safeWallet;
  const external = await read(); assert.equal(external?.recipient, safeWallet); assert.equal(external?.account, safeWallet);
  assert.notEqual(external?.recipient, tx().from, "Safe beneficiary credit belongs to the Safe, not its signer");
  emitted = false; assert.equal(await read(), undefined, "Successful Safe outer receipt does not prove an internal payout");
  safe = false; emitted = true; factory = true;
  const paid = await read(); assert.equal(paid?.kind, "creation-payout"); assert.equal(paid?.token, null);
  assert.equal(paid?.recipient, binding.creationFeeRecipient); assert.equal(paid?.account, launch.creator);
  badRecipient = true; await assert.rejects(read(), /settlement proof/); badRecipient = false;
  const lp = { ...block, transactionHash: hash(203), logIndex: 5, kind: "lp-claim" as const, account: safeWallet,
    nativeWei: "0", tokenWei: "3" };
  const indexed = fixtureLpFeeActivity({ token: launch.token, evidence: lp }, [{ ...cursor, lpLedger: account(505) }]);
  assert.equal(indexed?.recipient, safeWallet); assert.equal(indexed?.tokenWei, "3");
  assert.throws(() => fixtureLpFeeActivity({ token: launch.token, evidence: lp }, [cursor]), /settlement proof/);
}
