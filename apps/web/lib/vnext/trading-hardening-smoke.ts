import assert from "node:assert/strict";
import "./trade-journey-smoke";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { createInjectedSignerSelection, type InjectedSignerProvider } from "../injected-wallet-signer";
import { INJECTED_SIGNER_PREFERENCE_KEY } from "../injected-signer-preference";
import { walletGatewayKey } from "../wallet-gateway";
import { hasVerifiedVNextSwapSettlement, verifyVNextErc20OutputSettlement } from "./output-settlement";
import { resolvedVNextExecutionOutcome } from "./post-approval";
import type { VNextExecutionRecord } from "./execution-recovery";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const peepContract = "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f" as Address;
const holder = "0x0000000000001fF3684f28c67538d4D072C22734" as Address;
const h = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const walletKey = walletGatewayKey({ address: owner, connectorType: "injected", walletClientType: "metamask", meta: { id: "io.metamask" } });
const identity = { authenticated: true, userId: "test-authenticated-user", activeWalletKey: walletKey, address: owner, linkedAddress: owner, chainId: 4663 };
const uuid = "11111111-1111-4111-8111-111111111111";

async function main() {
  let saved: string | null = null;
  const storage = { getItem: (key: string) => key === INJECTED_SIGNER_PREFERENCE_KEY ? saved : null,
    setItem: (_key: string, value: string) => { saved = value; }, removeItem: () => { saved = null; } };
  function provider(accounts: unknown = [owner], chain = "0x1237") {
    const events = new Map<string, Set<(...args: unknown[]) => void>>();
    const methods: string[] = [];
    const result: InjectedSignerProvider = {
      async request({ method }) { methods.push(method); if (method === "eth_accounts") return accounts;
        if (method === "eth_chainId") return chain; throw Error("Unexpected provider method"); },
      on(event, listener) { const handlers = events.get(event) ?? new Set(); handlers.add(listener); events.set(event, handlers); },
      removeListener(event, listener) { events.get(event)?.delete(listener); }
    };
    return { result, methods, emit: (event: string) => [...(events.get(event) ?? [])].forEach((fn) => fn()) };
  }
  const announce = (selection: ReturnType<typeof createInjectedSignerSelection>, p: InjectedSignerProvider, id = uuid, rdns = "io.metamask") =>
    selection.announce({ info: { uuid: id, name: "MetaMask", rdns }, provider: p });
  const first = createInjectedSignerSelection({ storage: () => storage });
  first.setIdentity(identity); const p = provider(); announce(first, p.result);
  assert.equal(await first.restorePreference(), false, "first-time discovery is not user selection");
  first.select(uuid); await first.prepare(walletKey, owner);
  const preference = saved!;
  assert.deepEqual(Object.keys(JSON.parse(preference)).sort(), ["chainId", "connectorType", "name", "rdns", "version", "wallet", "walletKey"].sort());
  assert.equal(first.getSnapshot().selectedUuid, uuid);
  for (const accounts of [[owner], [owner, other], [other, owner]]) {
    saved = preference;
    const returning = createInjectedSignerSelection({ storage: () => storage });
    const selected = provider(accounts); returning.setIdentity(identity); announce(returning, selected.result);
    assert.equal(await returning.restorePreference(), true);
    const ticket = await returning.prepare(walletKey, owner);
    assert.equal(ticket.wallet, owner);
    assert.ok(selected.methods.every((method) => ["eth_accounts", "eth_chainId"].includes(method)));
    selected.emit("accountsChanged");
    assert.throws(() => returning.assertCurrent(ticket, walletKey, owner));
    assert.equal(saved, null);
  }
  for (const accounts of [[], [other], "malformed", [owner, "bad-address"]]) {
    saved = preference; const selection = createInjectedSignerSelection({ storage: () => storage });
    selection.setIdentity(identity); announce(selection, provider(accounts).result);
    assert.equal(await selection.restorePreference(), false);
    await assert.rejects(selection.prepare(walletKey, owner));
  }
  for (const scenario of ["ambiguous", "wrong-chain", "wrong-account", "identity-conflict", "absent"]) {
    saved = preference; const selection = createInjectedSignerSelection({ storage: () => storage });
    selection.setIdentity(identity);
    if (scenario !== "absent") announce(selection, provider(scenario === "wrong-account" ? [other] : [owner], scenario === "wrong-chain" ? "0x1" : "0x1237").result);
    if (scenario === "ambiguous") announce(selection, provider().result, "22222222-2222-4222-8222-222222222222");
    if (scenario === "identity-conflict") announce(selection, provider().result, uuid, "io.changed");
    assert.equal(await selection.restorePreference(), false, scenario);
  }
  saved = preference;
  const restored = createInjectedSignerSelection({ storage: () => storage });
  restored.setIdentity(identity); const raw = provider(); announce(restored, raw.result);
  assert.equal(await restored.restorePreference(), true);
  const ticket = await restored.prepare(walletKey, owner);
  announce(restored, provider().result, "33333333-3333-4333-8333-333333333333");
  assert.throws(() => restored.assertCurrent(ticket, walletKey, owner), "late ambiguity revokes remembered selection");

  const data = "0x12345678" as Hex;
  const record: VNextExecutionRecord = { schemaVersion: 1, chainId: 4663, wallet: owner, provider: "zero-x-swap", kind: "swap",
    inputAsset: zeroAddress, outputAsset: peepContract, inputAmountAtomic: "500000000000000", planId: uuid,
    payloadHash: h("a"), txHash: h("b"), state: "confirmed", submittedAtMs: Date.now(), updatedAtMs: Date.now(),
    providerNativeFee: { provider: "zero-x-swap", treasury: "0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC", feeAsset: zeroAddress,
      feeBps: 25, feeAmountAtomic: "1250000000000", expectedOutputAtomic: "1000", protectedOutputAtomic: "990",
      providerFeeAsset: null, providerFeeAtomic: null, transactionTarget: holder, calldataHash: keccak256(data) } };
  const transfer = (from: Address, to: Address, amount: bigint, asset = peepContract) => ({ address: asset,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]) });
  const receipt = { status: "success" as const, transactionHash: record.txHash, blockHash: h("c"), from: owner, to: holder, logs: [transfer(other, owner, 1000n)] };
  const tx = { hash: record.txHash, chainId: 4663, from: owner, to: holder, input: data, value: 500000000000000n, blockHash: receipt.blockHash };
  const proof = verifyVNextErc20OutputSettlement(record, receipt, tx);
  assert.ok(proof); assert.equal(proof.amountAtomic, "1000");
  const matching = { wallet: owner, inputAsset: record.inputAsset, outputAsset: peepContract, inputAmountAtomic: record.inputAmountAtomic };
  assert.equal(resolvedVNextExecutionOutcome({ ...matching, record })?.state, "confirmed_unsettled");
  const settled = { ...record, outputAmountAtomic: proof.amountAtomic, outputSettlement: proof };
  assert.equal(hasVerifiedVNextSwapSettlement(settled), true);
  assert.equal(resolvedVNextExecutionOutcome({ ...matching, record: settled })?.state, "swap_confirmed");
  for (const logs of [[], [transfer(other, other, 1000n)], [transfer(other, owner, 1000n, other)],
    [transfer(owner, owner, 1000n)], [transfer(other, owner, 1000n), transfer(owner, other, 11n)], [transfer(other, owner, 989n)]]) {
    assert.equal(verifyVNextErc20OutputSettlement(record, { ...receipt, logs }, tx), null);
  }
  for (const changed of [{ chainId: 1 }, { from: other }, { to: other }, { input: "0x12345679" as Hex }, { value: 1n }, { hash: h("d") }, { blockHash: h("d") }])
    assert.equal(verifyVNextErc20OutputSettlement(record, receipt, { ...tx, ...changed }), null);
  assert.equal(verifyVNextErc20OutputSettlement(record, { ...receipt, status: "reverted" }, tx), null);
  assert.equal(verifyVNextErc20OutputSettlement({ ...record, kind: "erc20_approval" }, receipt, tx), null);
  assert.equal(hasVerifiedVNextSwapSettlement({ ...settled, outputAsset: zeroAddress }), false);
  assert.equal(resolvedVNextExecutionOutcome({ ...matching, record: { ...record, kind: "erc20_approval" } })?.state, "approval_confirmed");
  assert.equal(resolvedVNextExecutionOutcome({ ...matching, record: { ...record, state: "reverted" } })?.state, "reverted");
  assert.equal(resolvedVNextExecutionOutcome({ ...matching, record: { ...record, state: "submitted" } }), null);
  console.log("Signer preference/rebinding and exact settlement regressions PASS; wallet dispatches 0.");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
