import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, zeroAddress, type Address, type Hex } from "viem";
import type { ZeroXSwapFirmQuoteVerificationEvidence } from "../lib/server/vnext-zero-x-firm-quote-verifier";

const rpcUrl = "https://rpc.mainnet.chain.robinhood.com/";
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const quantity = (value: string | bigint) => `0x${BigInt(value).toString(16)}`;
type Override = Record<string, { balance?: string; stateDiff?: Record<string, string> }>;
async function rpc(method: "eth_call" | "eth_getBlockByNumber" | "eth_chainId", params: unknown[]) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  const body = await response.json();
  if (!response.ok || body.error || body.result === undefined) {
    return { ok: false as const, code: typeof body.error?.code === "number" ? body.error.code : null,
      selector: typeof body.error?.data === "string" && /^0x[0-9a-f]{8}/i.test(body.error.data) ? body.error.data.slice(0, 10) : null };
  }
  return { ok: true as const, result: body.result };
}

// Test-only ephemeral state overrides. No contract code, runtime, quote field,
// pool state, fee, or slippage authority is replaced. Never a wallet envelope.
export async function simulateFundedZeroXEnvelope(firm: ZeroXSwapFirmQuoteVerificationEvidence) {
  const result: Record<string, unknown> = { status: "UNAVAILABLE", mode: "ETH_CALL_EPHEMERAL_FUNDING", walletAuthority: false };
  try {
    const chain = await rpc("eth_chainId", []);
    const block = await rpc("eth_getBlockByNumber", ["latest", false]);
    if (!chain.ok || chain.result !== "0x1237" || !block.ok || !/^0x[0-9a-f]+$/i.test(block.result?.number)) return result;
    const blockNumber = block.result.number;
    result.blockNumber = BigInt(blockNumber).toString(); result.blockHash = block.result.hash;
    const overrides: Override = { [firm.recipient]: { balance: quantity(100n * 10n ** 18n) } };
    const amount = BigInt(firm.inputAmountAtomic);
    if (firm.inputAsset !== zeroAddress) {
      const balanceData = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [firm.recipient] });
      const allowanceData = encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [firm.recipient, firm.approvalSpender] });
      const findSlot = async (data: Hex, allowance: boolean): Promise<Hex | null> => {
        // Bounded standard Solidity mapping discovery. Two distinct readbacks
        // must prove each exact mapping; unsupported layouts stay unproven.
        for (let slot = 0; slot < 16; ++slot) {
          const ownerSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [firm.recipient, BigInt(slot)]));
          const key = allowance ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [firm.approvalSpender as Address, ownerSlot])) : ownerSlot;
          const probe = { ...overrides, [firm.inputAsset]: { stateDiff: { [key]: word(amount) } } };
          const first = await rpc("eth_call", [{ to: firm.inputAsset, data }, blockNumber, probe]);
          if (!first.ok || typeof first.result !== "string" || first.result.toLowerCase() !== word(amount)) continue;
          probe[firm.inputAsset].stateDiff![key] = word(amount + 137n);
          const second = await rpc("eth_call", [{ to: firm.inputAsset, data }, blockNumber, probe]);
          if (second.ok && second.result === word(amount + 137n)) return key;
        }
        return null;
      };
      const balanceSlot = await findSlot(balanceData, false);
      const allowanceSlot = await findSlot(allowanceData, true);
      if (!balanceSlot || !allowanceSlot || balanceSlot === allowanceSlot) return { ...result, status: "UNSUPPORTED_TOKEN_STORAGE_LAYOUT" };
      overrides[firm.inputAsset] = { stateDiff: { [balanceSlot]: word(amount), [allowanceSlot]: word(amount) } };
      for (const data of [balanceData, allowanceData]) {
        const check = await rpc("eth_call", [{ to: firm.inputAsset, data }, blockNumber, overrides]);
        if (!check.ok || check.result !== word(amount)) return { ...result, status: "FUNDING_READBACK_FAILED" };
      }
      result.balanceSlot = balanceSlot; result.allowanceSlot = allowanceSlot;
      result.allowanceSpender = firm.approvalSpender; result.allowanceAtomic = firm.inputAmountAtomic;
    }
    const envelope = firm.providerNativeFee!.firmQuote!;
    const call = await rpc("eth_call", [{ from: firm.recipient, to: firm.router, data: firm.transactionData,
      value: quantity(firm.swapTransactionValueAtomic), gas: quantity(envelope.swapGasLimitUnits),
      ...(envelope.gasPriceWei !== null ? { gasPrice: quantity(envelope.gasPriceWei) } : {}) }, blockNumber, overrides]);
    return { ...result, status: call.ok ? "PASS" : "REVERT_OR_RPC_ERROR", errorCode: call.ok ? null : call.code,
      errorSelector: call.ok ? null : call.selector, calldataHash: firm.calldataHash,
      gasLimit: envelope.swapGasLimitUnits, gasPrice: envelope.gasPriceWei,
      transactionTarget: firm.router, transactionValue: firm.swapTransactionValueAtomic,
      protectedOutput: firm.encodedExecutableMinBuyAmount, exactEnvelopePreserved: true };
  } catch { return { ...result, status: "RPC_UNAVAILABLE" }; }
}
