import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { encodeAbiParameters, hashTypedData, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { claimDelegatePin, claimSafePins, claimSafeTypedData, type ClaimPreparationInput } from "./claim-profiles";
import { ea, earningsTestFixture, fixtureCode } from "./earnings-test-fixture";
import type { EarningsRpc } from "./earnings-contracts";
const safeArchive = JSON.parse(gunzipSync(readFileSync(new URL("../../../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz", import.meta.url))).toString());
const safeRuntime = JSON.parse(readFileSync(new URL("../../../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json", import.meta.url), "utf8"));
export const delegateArchive = JSON.parse(gunzipSync(readFileSync(new URL("./claim-delegate-runtime.test.json.gz", import.meta.url))).toString());
export const productionArchive = JSON.parse(gunzipSync(readFileSync(new URL("./earnings-production-runtime.test.json.gz", import.meta.url))).toString());
export const owners = [1, 2, 3].map(n => privateKeyToAccount(("0x" + n.toString(16).padStart(64, "0")) as Hex)); // Synthetic unit-test identities only.
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function fixture(kind: "eoa" | "metamask-7702" | "safe-1.4.1" = "eoa", graduated = true) {
  const f = earningsTestFixture({ graduated });
  const original = f.context.rpc;
  const payer = kind === "safe-1.4.1" ? ea(999991) : f.creator;
  const state = { kind, undefinedEmpty: true, malformedCode: false, throwCode: false, badDelegate: false, pendingDelegateChanged: false,
    badProxy: false, ownerCount: 3n, threshold: 2n, safeNonce: 0n, payerNonce: 0, receiptNonce: 0,
    guard: false, modules: false, badHandler: false, badSingleton: false, badOwner: false, feeFailure: false, safeSimulationFailure: false, price: 2n, gas: 30000n };
  const rpc = { ...original,
    getCode: async (arg: { address: Address; blockTag?: string; blockNumber?: bigint }) => {
      if (state.throwCode && same(arg.address, payer)) throw Error("Provider unavailable");
      if (owners.some(o => same(o.address, arg.address))) return state.badOwner ? fixtureCode : state.undefinedEmpty ? undefined : "0x";
      if (same(arg.address, claimSafePins.singleton)) return safeRuntime.contracts.safe_l2.code;
      if (same(arg.address, claimSafePins.fallbackHandler)) return safeRuntime.contracts.compatibility_fallback_handler.code;
      if (same(arg.address, claimDelegatePin.address)) return state.badDelegate ? fixtureCode : delegateArchive.delegate.code;
      if (same(arg.address, f.creator) && state.kind === "safe-1.4.1") return state.badProxy ? fixtureCode : safeArchive.proxyRuntimeCode;
      if (same(arg.address, payer)) {
        if (state.malformedCode) return null;
        if (state.kind === "metamask-7702") return arg.blockTag === "pending" && state.pendingDelegateChanged ? "0x" : claimDelegatePin.designator;
        return state.undefinedEmpty ? undefined : "0x";
      }
      return original.getCode(arg as never);
    },
    getTransactionCount: async (arg: { address: Address; blockTag?: string; blockNumber?: bigint }) => {
      if (same(arg.address, f.creator) && state.kind === "safe-1.4.1") return 1;
      return arg.blockNumber && arg.blockNumber >= 11n ? state.receiptNonce : state.payerNonce;
    },
    getStorageAt: async ({ slot }: { slot: Hex }) => slot === "0x3" ? "0x" + state.ownerCount.toString(16).padStart(64, "0")
      : slot.startsWith("0x4a204") ? "0x" + (state.guard ? "1" : "0").padStart(64, "0")
      : "0x" + (state.badHandler ? ea(999992) : claimSafePins.fallbackHandler).slice(2).toLowerCase().padStart(64, "0"),
    getGasPrice: async () => state.price,
    call: async (arg: { to: Address }) => state.kind === "safe-1.4.1" && same(arg.to, f.creator)
      ? { data: encodeAbiParameters([{ type: "bool" }], [!state.safeSimulationFailure]) } : original.call(arg as never),
    estimateGas: async () => { if (state.feeFailure) throw Error("No simulation"); return state.gas; },
    readContract: async (arg: { address: Address; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) => {
      if (state.kind === "safe-1.4.1" && same(arg.address, f.creator)) {
        switch (arg.functionName) {
          case "VERSION": return "1.4.1";
          case "masterCopy": return state.badSingleton ? ea(999993) : claimSafePins.singleton;
          case "getOwners": return owners.map(o => o.address);
          case "getThreshold": return state.threshold;
          case "nonce": return state.safeNonce;
          case "getModulesPaginated": return [state.modules ? [ea(999994)] : [], "0x0000000000000000000000000000000000000001"];
          case "getTransactionHash": {
            const [to, , data, , , , , , , nonce] = arg.args!;
            return hashTypedData(claimSafeTypedData(31337, f.creator, { to: to as Address, value: "0", data: data as Hex,
              operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: String(nonce) }));
          }
        }
      }
      return original.readContract(arg as never);
    },
  } as unknown as EarningsRpc;
  f.context.rpc = rpc;
  const input: ClaimPreparationInput = { context: f.context, registration: f.registration, operation: "curve-claim", beneficiary: f.creator,
    account: payer, kind, ...(kind === "safe-1.4.1" && { safeAddress: f.creator }) };
  return { ...f, input, state, baseState: f.state };
}
