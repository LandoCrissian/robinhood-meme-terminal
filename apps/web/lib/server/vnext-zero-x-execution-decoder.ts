import { TradeExecutionFailure } from "../vnext/trade-failure";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, toFunctionSelector, zeroAddress, type Address, type Hex } from "viem";
import { fromZeroXToken, RMT_ZERO_X_FEE_TREASURY, ZERO_X_NATIVE_TOKEN } from "../vnext/zero-x-settlement";

// RobinHoodSettler, official 0x commit 95184a23336b52d99aaa528c5b1259e3bb04eafe.
// Sourcify's recompiled runtime exactly matched eth_getCode on chain 4663.
// Settler._execute calls _checkSlippageAndTransfer AFTER all actions/fees.
// Unknown runtimes are NOT authorized by ABI compatibility alone.
export const ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH = "0xb6c0bf3b83bc9ae4f6ed65a4f5f6c188eb3e4258d8d3b3705dff4ac02ed4a966";
// Reproduced RobinHoodSettler 1df908742d38cf407f667df6518dae6e04a01ac3.
// See docs/RMT_ZEROX_ALLOWANCE_HOLDER_PUBLIC_EXECUTION_V1.md for the review scope.
export const ZERO_X_PPM_SETTLER_RUNTIME_HASH = "0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f";
export function zeroXReviewedActionBasis(runtimeHash: string): bigint {
  if (runtimeHash === ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH) return 10_000n;
  if (runtimeHash === ZERO_X_PPM_SETTLER_RUNTIME_HASH) return 1_000_000n;
  throw new TradeExecutionFailure("CONTRACT_VERSION_UNSUPPORTED");
}
const HOLDER = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const holderAbi = parseAbi(["function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)"]);
const settlerAbi = parseAbi(["function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag) payable returns(bool)"]);
const earlySlippage = toFunctionSelector("CHECK_SLIPPAGE(bool)");

export function decodeZeroXExecutableMinimum(input: {
  target: Address; data: Hex; inputAsset: Address; outputAsset: Address;
  inputAmountAtomic: string; recipient: Address; valueAtomic: string;
}) {
  try {
    let target = input.target;
    let data = input.data;
    const native = input.inputAsset === zeroAddress;
    if (BigInt(input.valueAtomic) !== (native ? BigInt(input.inputAmountAtomic) : 0n)) throw new Error();
    if (getAddress(target) === HOLDER) {
      const decoded = decodeFunctionData({ abi: holderAbi, data });
      if (encodeFunctionData({ abi: holderAbi, ...decoded }).toLowerCase() !== data.toLowerCase()) throw new Error();
      const [operator, token, amount, forwardedTarget, forwardedData] = decoded.args;
      if (amount.toString() !== input.inputAmountAtomic || getAddress(operator) !== getAddress(forwardedTarget)
        || getAddress(token) !== input.inputAsset || getAddress(forwardedTarget) === HOLDER) throw new Error();
      target = getAddress(forwardedTarget);
      data = forwardedData;
    } else if (!native) throw new Error();
    const decoded = decodeFunctionData({ abi: settlerAbi, data });
    if (encodeFunctionData({ abi: settlerAbi, ...decoded }).toLowerCase() !== data.toLowerCase()) throw new Error();
    const { args: [slippage, actions] } = decoded;
    if (getAddress(slippage.recipient) !== getAddress(input.recipient)
      || fromZeroXToken(slippage.buyToken) !== input.outputAsset || slippage.minAmountOut <= 0n
      || actions.length === 0 || actions.length > 256
      // Reject early transfers: only the final, post-fee global check is admitted.
      || actions.some(action => action.length < 10 || action.slice(0, 10) === earlySlippage)) throw new Error();
    return { minimumAtomic: slippage.minAmountOut.toString(), settlerTarget: target, actions };
  } catch {
    // Never include raw calldata or decoder exceptions in public diagnostics.
    throw new TradeExecutionFailure("EXECUTION_ENVELOPE_REJECTED");
  }
}

const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const actionsAbi = parseAbi([
  "function NATIVE_CHECK(uint256 deadline,uint256 msgValue)",
  "function TRANSFER_FROM(address recipient,((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,bytes sig)",
  "function BASIC(address sellToken,uint256 proportion,address pool,uint256 offset,bytes data)",
  "function UNISWAPV3(address recipient,uint256 proportion,bytes path,uint256 amountOutMin)",
  "function PANCAKE_INFINITY(address recipient,address sellToken,uint256 proportion,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 amountOutMin)",
  "function POSITIVE_SLIPPAGE(address recipient,address token,uint256 expectedAmount,uint256 maximumProportion)"
]);
const transferAbi = parseAbi(["function transfer(address recipient,uint256 amount) returns(bool)"]);
const fail = () => { throw new TradeExecutionFailure("EXECUTION_ENVELOPE_REJECTED"); };

/** Reviewed provider-native intent, NOT an atomic fee or settlement proof.
 * Unknown actions/calls/transfer destinations fail closed. Routing is non-VIP,
 * paid by Settler, with all routing proceeds returned to Settler for the final check.
 */
export function verifyZeroXEncodedFee(input: Parameters<typeof decodeZeroXExecutableMinimum>[0] & {
  runtimeHash: string; expectedOutputAtomic: string;
  providerFeeAsset: Address | null; providerFeeAtomic: string | null;
}) {
  const basis = zeroXReviewedActionBasis(input.runtimeHash);
  try {
    const envelope = decodeZeroXExecutableMinimum(input);
    const decoded = envelope.actions.map(data => {
      const action = decodeFunctionData({ abi: actionsAbi, data });
      // The official decoder accepts noncanonical offsets. Our supported subset
      // requires a canonical ABI action to avoid two interpretations of the bytes.
      if (encodeFunctionData({ abi: actionsAbi, ...action } as Parameters<typeof encodeFunctionData>[0]).toLowerCase() !== data.toLowerCase()) fail();
      return action;
    });
    let index = 0;
    const next = () => { const action = decoded[index++]; if (!action) return fail(); return action; };
    const native = input.inputAsset === zeroAddress;
    const first = next();
    if (native) {
      if (first.functionName !== "NATIVE_CHECK" || first.args[1] !== BigInt(input.inputAmountAtomic) || first.args[0] === 0n) fail();
    } else {
      if (first.functionName !== "TRANSFER_FROM") return fail();
      const [recipient, permit, signature] = first.args;
      if (getAddress(recipient) !== envelope.settlerTarget || getAddress(permit.permitted.token) !== input.inputAsset
        || permit.permitted.amount !== BigInt(input.inputAmountAtomic) || permit.nonce !== 0n || permit.deadline === 0n || signature !== "0x") fail();
    }
    function transfer(action: ReturnType<typeof next>, asset: Address, proportion: bigint, destination: (address: Address) => boolean) {
      if (action.functionName !== "BASIC") return fail();
      const [token, rate, pool, offset, data] = action.args;
      if (fromZeroXToken(token) !== asset || rate !== proportion) fail();
      if (asset === zeroAddress) {
        if (offset !== 0n || data !== "0x" || !destination(getAddress(pool))) fail();
      } else {
        if (getAddress(pool) !== asset || offset !== 36n) fail();
        const nested = decodeFunctionData({ abi: transferAbi, data });
        if (encodeFunctionData({ abi: transferAbi, ...nested }).toLowerCase() !== data.toLowerCase()
          || nested.args[1] !== 0n || !destination(getAddress(nested.args[0]))) fail();
      }
    }
    transfer(next(), input.inputAsset, basis / 400n, address => address === RMT_ZERO_X_FEE_TREASURY);
    const fee = { token: input.inputAsset, recipient: RMT_ZERO_X_FEE_TREASURY, rateBps: 25 as const,
      position: 1, count: 1 as const, numerator: (basis / 400n).toString(), denominator: basis.toString(),
      amountMode: "PROPORTIONAL_TO_CURRENT_BALANCE" as const, rounding: "FLOOR" as const };
    let providerFeeSeen = false;
    // Provider destinations are supplied by 0x, not RMT treasury authority.
    // This classifies the single separately disclosed reviewed 15-bps charge;
    // it does not attest ownership of its destination or call it RMT revenue.
    const nonRmtDestination = (address: Address) => ![zeroAddress, RMT_ZERO_X_FEE_TREASURY,
      input.recipient, envelope.settlerTarget, HOLDER, input.inputAsset, input.outputAsset].includes(address);
    const providerTransfer = (asset: Address) => {
      if (input.providerFeeAsset !== asset || input.providerFeeAtomic === null || providerFeeSeen) fail();
      const disclosed = BigInt(input.providerFeeAtomic!);
      if (disclosed <= 0n) fail();
      transfer(next(), asset, basis * 15n / 10_000n, nonRmtDestination);
      providerFeeSeen = true;
    };
    // The retained quotes place a sell-token provider fee after the RMT fee.
    if (input.providerFeeAsset === input.inputAsset) providerTransfer(input.inputAsset);
    let routeInput = input.inputAsset;
    if (native) {
      const wrap = next();
      if (wrap.functionName !== "BASIC" || getAddress(wrap.args[0]) !== ZERO_X_NATIVE_TOKEN || wrap.args[1] !== basis
        || getAddress(wrap.args[2]) !== WETH || wrap.args[3] !== 4n
        || wrap.args[4].toLowerCase() !== toFunctionSelector("deposit()") + "0".repeat(64)) fail();
      routeInput = WETH;
    }
    const route = next();
    let routeOutput: Address;
    if (route.functionName === "UNISWAPV3") {
      const [recipient, proportion, path] = route.args;
      const bytes = (path.length - 2) / 2;
      if (getAddress(recipient) !== envelope.settlerTarget || proportion !== basis || bytes < 64 || (bytes - 20) % 44 !== 0 || bytes > 724) fail();
      if (getAddress(`0x${path.slice(2, 42)}`) !== routeInput) fail();
      routeOutput = getAddress(`0x${path.slice(-40)}`);
    } else if (route.functionName === "PANCAKE_INFINITY") {
      if (input.runtimeHash !== ZERO_X_PPM_SETTLER_RUNTIME_HASH) fail();
      const [recipient, token, proportion, feeOnTransfer, , , fills] = route.args;
      if (getAddress(recipient) !== envelope.settlerTarget || fromZeroXToken(token) !== routeInput || proportion !== basis || feeOnTransfer) fail();
      // Packed swap instructions contain no transfer recipient. Unknown hooks can
      // introduce fee behavior, so only hook-free reviewed manager IDs are admitted.
      let cursor = 2, sell = token, buy = token, count = 0;
      const take = (bytes: number) => { const end = cursor + bytes * 2; if (end > fills.length) return fail(); const value = fills.slice(cursor, end); cursor = end; return value; };
      while (cursor < fills.length) {
        if (++count > 16) fail();
        const proportion = BigInt(`0x${take(3)}`); take(20);
        const key = Number.parseInt(take(1), 16);
        if (proportion === 0n || proportion > basis || key > 3 || (count === 1 && key !== 1)) fail();
        if (key === 2) sell = buy;
        if (key === 3) sell = getAddress(`0x${take(20)}`);
        if (key !== 0) buy = getAddress(`0x${take(20)}`);
        if (getAddress(sell) === getAddress(buy) || getAddress(`0x${take(20)}`) !== zeroAddress) fail();
        if (Number.parseInt(take(1), 16) > 1) fail();
        take(3); take(32);
        if (Number.parseInt(take(3), 16) !== 0) fail();
      }
      if (count === 0) return fail();
      routeOutput = fromZeroXToken(buy);
    } else return fail();
    if (input.outputAsset === zeroAddress && routeOutput === WETH) {
      const unwrap = next();
      if (unwrap.functionName !== "BASIC" || getAddress(unwrap.args[0]) !== WETH || unwrap.args[1] !== basis
        || getAddress(unwrap.args[2]) !== WETH || unwrap.args[3] !== 4n
        || unwrap.args[4].toLowerCase() !== toFunctionSelector("withdraw(uint256)") + "0".repeat(64)) fail();
      routeOutput = zeroAddress;
    }
    if (routeOutput !== input.outputAsset) fail();
    if (decoded[index]?.functionName === "POSITIVE_SLIPPAGE") {
      const surplus = next();
      if (surplus.functionName !== "POSITIVE_SLIPPAGE") return fail();
      const [recipient, token, expected, cap] = surplus.args;
      if (!nonRmtDestination(getAddress(recipient)) || fromZeroXToken(token) !== input.outputAsset
        || expected < BigInt(input.expectedOutputAtomic) || cap !== basis) fail();
    }
    if (input.providerFeeAsset === input.outputAsset) providerTransfer(input.outputAsset);
    if (providerFeeSeen !== (input.providerFeeAsset !== null) || index !== decoded.length) fail();
    return fee;
  } catch {
    throw new TradeExecutionFailure("EXECUTION_ENVELOPE_REJECTED");
  }
}
