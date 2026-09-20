import { decodeZeroXPackedRoute } from "./vnext-zero-x-packed-route";
import { ExecutionEnvelopeFailure, TradeExecutionFailure } from "../vnext/trade-failure";
import type { EnvelopeReason } from "../vnext/execution-envelope-diagnostic";
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
  const fail = (envelopeReason: EnvelopeReason, actionIndex: number | null = null, actionKind: string | null = null): never => {
    throw new ExecutionEnvelopeFailure({ envelopeReason, envelopeFunction: "decodeZeroXExecutableMinimum", actionIndex, actionKind });
  };
  let decoding: EnvelopeReason = "MALFORMED_ENVELOPE";
  try {
    let target = input.target;
    let data = input.data;
    const native = input.inputAsset === zeroAddress;
    if (BigInt(input.valueAtomic) !== (native ? BigInt(input.inputAmountAtomic) : 0n)) fail("TRANSACTION_VALUE_MISMATCH");
    if (getAddress(target) === HOLDER) {
      decoding = "ALLOWANCEHOLDER_DECODE_FAILED";
      const decoded = decodeFunctionData({ abi: holderAbi, data });
      if (encodeFunctionData({ abi: holderAbi, ...decoded }).toLowerCase() !== data.toLowerCase()) fail("ALLOWANCEHOLDER_NONCANONICAL");
      const [operator, token, amount, forwardedTarget, forwardedData] = decoded.args;
      if (amount.toString() !== input.inputAmountAtomic) fail("INPUT_AMOUNT_MISMATCH");
      if (getAddress(operator) !== getAddress(forwardedTarget)) fail("OPERATOR_MISMATCH");
      if (getAddress(token) !== input.inputAsset) fail("INPUT_TOKEN_MISMATCH");
      if (getAddress(forwardedTarget) === HOLDER) fail("SETTLER_TARGET_INVALID");
      target = getAddress(forwardedTarget);
      data = forwardedData;
    } else if (!native) fail("ALLOWANCEHOLDER_REQUIRED");
    decoding = "SETTLER_DECODE_FAILED";
    const decoded = decodeFunctionData({ abi: settlerAbi, data });
    if (encodeFunctionData({ abi: settlerAbi, ...decoded }).toLowerCase() !== data.toLowerCase()) fail("SETTLER_NONCANONICAL");
    const { args: [slippage, actions] } = decoded;
    if (getAddress(slippage.recipient) !== getAddress(input.recipient)) fail("RECIPIENT_MISMATCH");
    if (fromZeroXToken(slippage.buyToken) !== input.outputAsset) fail("OUTPUT_TOKEN_MISMATCH");
    if (slippage.minAmountOut <= 0n) fail("MINIMUM_INVALID");
    if (actions.length === 0 || actions.length > 256) fail("ACTION_COUNT_INVALID");
    // Reject early transfers: only the final, post-fee global check is admitted.
    actions.forEach((action, index) => {
      if (action.length < 10) fail("MALFORMED_ACTION", index);
      if (action.slice(0, 10).toLowerCase() === earlySlippage) fail("EARLY_SLIPPAGE", index, "CHECK_SLIPPAGE");
    });
    return { minimumAtomic: slippage.minAmountOut.toString(), settlerTarget: target, actions };
  } catch (cause) {
    // Never include raw calldata or decoder exceptions in public diagnostics.
    if (cause instanceof ExecutionEnvelopeFailure) throw cause;
    return fail(decoding);
  }
}

const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const actionsAbi = parseAbi([
  "function NATIVE_CHECK(uint256 deadline,uint256 msgValue)",
  "function TRANSFER_FROM(address recipient,((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,bytes sig)",
  "function BASIC(address sellToken,uint256 proportion,address pool,uint256 offset,bytes data)",
  "function UNISWAPV3(address recipient,uint256 proportion,bytes path,uint256 amountOutMin)",
  "function EKUBOV3(address recipient,address sellToken,uint256 proportion,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 amountOutMin)",
  "function UNISWAPV4(address recipient,address sellToken,uint256 proportion,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 amountOutMin)",
  "function PANCAKE_INFINITY(address recipient,address sellToken,uint256 proportion,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 amountOutMin)",
  "function POSITIVE_SLIPPAGE(address recipient,address token,uint256 expectedAmount,uint256 maximumProportion)"
]);
const transferAbi = parseAbi(["function transfer(address recipient,uint256 amount) returns(bool)"]);
const transferFromAbi = parseAbi(["function transferFrom(address owner,address recipient,uint256 amount) returns(bool)"]);
// Exact non-proxy LFJ v2.0.0 deployment, reproduced from official source.
// See docs/ZEROX_LIQUIDITY_BOOK_ROUTE_REVIEW.md. This is a Settler routing
// target, never a public executor or wallet approval spender.
const liquidityBookRouter = getAddress("0x4463c6f5BaDE414eC5E34D94245ec0F55C4d8B51");
const liquidityBookAbi = parseAbi(["function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,uint256[] pairBinSteps,address[] tokenPath,address to,uint256 deadline) returns(uint256)"]);
const liquidityBookSelector = toFunctionSelector(liquidityBookAbi[0]);
const actionNames = new Map(actionsAbi.map(action => [toFunctionSelector(action), action.name]));

/** Hard input/fee authority for a server-obtained quote from an authenticated
 * reviewed Settler. This function alone is NOT execution admission: deployment,
 * quote/asset binding, exact RPC simulation and committed wallet authority remain
 * mandatory in the firm verifier/authorization path. Internal routing is 0x's
 * responsibility; the reviewed execute entrypoint enforces the final minimum.
 */
export function verifyZeroXEncodedFee(input: ZeroXEnvelopeInput) {
  const basis = zeroXReviewedActionBasis(input.runtimeHash);
  let actionIndex: number | null = null;
  let actionKind: string | null = null;
  const fail = (envelopeReason: EnvelopeReason): never => {
    throw new ExecutionEnvelopeFailure({ envelopeReason, envelopeFunction: "verifyZeroXEncodedFee", actionIndex, actionKind });
  };
  try {
    const envelope = decodeZeroXExecutableMinimum(input);
    const decoded = envelope.actions.slice(0, 2).map((data, index) => {
      actionIndex = index;
      const selector = data.slice(0, 10).toLowerCase() as Hex;
      actionKind = actionNames.get(selector) ?? selector;
      if (!actionNames.has(selector)) fail("UNSUPPORTED_ACTION");
      const action = decodeFunctionData({ abi: actionsAbi, data });
      // The official decoder accepts noncanonical offsets. Our supported subset
      // requires a canonical ABI action to avoid two interpretations of the bytes.
      if (encodeFunctionData({ abi: actionsAbi, ...action } as Parameters<typeof encodeFunctionData>[0]).toLowerCase() !== data.toLowerCase()) fail("NONCANONICAL_ACTION");
      return action;
    });
    let index = 0;
    const next = () => { actionIndex = index; const action = decoded[index++]; actionKind = action?.functionName ?? null; if (!action) return fail("MISSING_ACTION"); return action; };
    const native = input.inputAsset === zeroAddress;
    const first = next();
    if (native) {
      if (first.functionName !== "NATIVE_CHECK" || first.args[1] !== BigInt(input.inputAmountAtomic) || first.args[0] === 0n) fail("INPUT_ACTION_MISMATCH");
    } else {
      if (first.functionName !== "TRANSFER_FROM") return fail("INPUT_ACTION_MISMATCH");
      const [recipient, permit, signature] = first.args;
      if (getAddress(recipient) !== envelope.settlerTarget || getAddress(permit.permitted.token) !== input.inputAsset
        || permit.permitted.amount !== BigInt(input.inputAmountAtomic) || permit.nonce !== 0n || permit.deadline === 0n || signature !== "0x") fail("INPUT_TRANSFER_BINDING_MISMATCH");
    }
    function transfer(action: ReturnType<typeof next>, asset: Address, proportion: bigint, destination: (address: Address) => boolean) {
      if (action.functionName !== "BASIC") return fail("FEE_ACTION_MISMATCH");
      const [token, rate, pool, offset, data] = action.args;
      if (fromZeroXToken(token) !== asset) fail("FEE_TOKEN_MISMATCH");
      if (rate !== proportion) fail("FEE_RATE_MISMATCH");
      if (asset === zeroAddress) {
        if (offset !== 0n || data !== "0x") fail("FEE_TRANSFER_ENCODING_MISMATCH");
        if (!destination(getAddress(pool))) fail("FEE_RECIPIENT_MISMATCH");
      } else {
        if (getAddress(pool) !== asset || offset !== 36n) fail("FEE_TRANSFER_ENCODING_MISMATCH");
        const nested = decodeFunctionData({ abi: transferAbi, data });
        if (encodeFunctionData({ abi: transferAbi, ...nested }).toLowerCase() !== data.toLowerCase()
          || nested.args[1] !== 0n) fail("FEE_TRANSFER_ENCODING_MISMATCH");
        if (!destination(getAddress(nested.args[0]))) fail("FEE_RECIPIENT_MISMATCH");
      }
    }
    transfer(next(), input.inputAsset, basis / 400n, address => address === RMT_ZERO_X_FEE_TREASURY);
    const fee = { token: input.inputAsset, recipient: RMT_ZERO_X_FEE_TREASURY, rateBps: 25 as const,
      position: 1, count: 1 as const, numerator: (basis / 400n).toString(), denominator: basis.toString(),
      amountMode: "PROPORTIONAL_TO_CURRENT_BALANCE" as const, rounding: "FLOOR" as const };
    // Only authority-affecting suffix structures belong in this gate. Do not
    // decode internal DEX paths, recipients, pool keys, hooks or intermediate assets.
    for (let i = 2; i < envelope.actions.length; i++) {
      actionIndex = i;
      const data = envelope.actions[i];
      const selector = data.slice(0, 10).toLowerCase() as Hex;
      actionKind = actionNames.get(selector) ?? selector;
      if (actionKind === "TRANSFER_FROM") fail("EXTRA_INPUT_AUTHORITY");
      if (actionKind !== "BASIC") continue;
      const action = decodeFunctionData({ abi: actionsAbi, data });
      if (action.functionName !== "BASIC") return fail("MALFORMED_ACTION");
      const [token, , pool, , nested] = action.args;
      // Authority targets, not a list of allowed DEX/router addresses.
      if ([HOLDER, getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"), envelope.settlerTarget].includes(getAddress(pool))) fail("EXTRA_INPUT_AUTHORITY");
      if (nested.slice(0, 10).toLowerCase() === toFunctionSelector(transferFromAbi[0])
        && getAddress(decodeFunctionData({ abi: transferFromAbi, data: nested }).args[0]) === getAddress(input.recipient)) fail("EXTRA_INPUT_AUTHORITY");
      let destination: Address | null = null;
      // BASIC token=0 means no input transfer, not native ETH. It is a valid
      // provider-internal call mode and must not use response-token normalization.
      if (getAddress(token) === ZERO_X_NATIVE_TOKEN && nested === "0x") destination = getAddress(pool);
      else if (getAddress(pool) === getAddress(token) && nested.slice(0, 10).toLowerCase() === toFunctionSelector(transferAbi[0])) {
        destination = getAddress(decodeFunctionData({ abi: transferAbi, data: nested }).args[0]);
      }
      if (destination === null) continue; // Opaque internal BASIC, not an inferred fee.
      if (destination === RMT_ZERO_X_FEE_TREASURY) fail("DUPLICATE_RMT_FEE");
      // Other transfers may be provider fees or internal pool funding. Provider
      // fee disclosure remains separate; do not infer a fee from a route split.
    }
    return fee;
  } catch (cause) {
    if (cause instanceof ExecutionEnvelopeFailure) throw cause;
    return fail("MALFORMED_ACTION");
  }
}

export type ZeroXEnvelopeInput = Parameters<typeof decodeZeroXExecutableMinimum>[0] & {
  runtimeHash: string; expectedOutputAtomic: string;
  providerFeeAsset: Address | null; providerFeeAtomic: string | null;
};

/** Non-authoritative diagnostics. Hard checks are evaluated separately and are
 * never caught here. A partial parse is not evidence that simulation passed.
 * Parser exceptions are normalized to bounded diagnostics inside the inspector.
 */
export function inspectZeroXRoute(input: ZeroXEnvelopeInput) {
  try {
    inspectKnownRouteGrammar(input);
    return { status: "ROUTE_INTROSPECTION_COMPLETE" as const, diagnostic: null };
  } catch (cause) {
    if (!(cause instanceof ExecutionEnvelopeFailure)) throw cause;
    return { status: "ROUTE_INTROSPECTION_PARTIAL" as const, diagnostic: cause.envelope };
  }
}

/** Reviewed provider-native intent, NOT an atomic fee or settlement proof.
 * Diagnostic subset only. Never use this parser as execution admission.
 */
function inspectKnownRouteGrammar(input: Parameters<typeof decodeZeroXExecutableMinimum>[0] & {
  runtimeHash: string; expectedOutputAtomic: string;
  providerFeeAsset: Address | null; providerFeeAtomic: string | null;
}) {
  const basis = zeroXReviewedActionBasis(input.runtimeHash);
  let actionIndex: number | null = null;
  let actionKind: string | null = null;
  const fail = (envelopeReason: EnvelopeReason): never => {
    throw new ExecutionEnvelopeFailure({ envelopeReason, envelopeFunction: "inspectZeroXRoute", actionIndex, actionKind });
  };
  try {
    const envelope = decodeZeroXExecutableMinimum(input);
    const decoded = envelope.actions.map((data, index) => {
      actionIndex = index;
      const selector = data.slice(0, 10).toLowerCase() as Hex;
      actionKind = actionNames.get(selector) ?? selector;
      if (!actionNames.has(selector)) fail("UNSUPPORTED_ACTION");
      const action = decodeFunctionData({ abi: actionsAbi, data });
      // The official decoder accepts noncanonical offsets. Our supported subset
      // requires a canonical ABI action to avoid two interpretations of the bytes.
      if (encodeFunctionData({ abi: actionsAbi, ...action } as Parameters<typeof encodeFunctionData>[0]).toLowerCase() !== data.toLowerCase()) fail("NONCANONICAL_ACTION");
      return action;
    });
    let index = 0;
    const next = () => { actionIndex = index; const action = decoded[index++]; actionKind = action?.functionName ?? null; if (!action) return fail("MISSING_ACTION"); return action; };
    const native = input.inputAsset === zeroAddress;
    const first = next();
    if (native) {
      if (first.functionName !== "NATIVE_CHECK" || first.args[1] !== BigInt(input.inputAmountAtomic) || first.args[0] === 0n) fail("INPUT_ACTION_MISMATCH");
    } else {
      if (first.functionName !== "TRANSFER_FROM") return fail("INPUT_ACTION_MISMATCH");
      const [recipient, permit, signature] = first.args;
      if (getAddress(recipient) !== envelope.settlerTarget || getAddress(permit.permitted.token) !== input.inputAsset
        || permit.permitted.amount !== BigInt(input.inputAmountAtomic) || permit.nonce !== 0n || permit.deadline === 0n || signature !== "0x") fail("INPUT_TRANSFER_BINDING_MISMATCH");
    }
    function transfer(action: ReturnType<typeof next>, asset: Address, proportion: bigint, destination: (address: Address) => boolean) {
      if (action.functionName !== "BASIC") return fail("FEE_ACTION_MISMATCH");
      const [token, rate, pool, offset, data] = action.args;
      if (fromZeroXToken(token) !== asset) fail("FEE_TOKEN_MISMATCH");
      if (rate !== proportion) fail("FEE_RATE_MISMATCH");
      if (asset === zeroAddress) {
        if (offset !== 0n || data !== "0x") fail("FEE_TRANSFER_ENCODING_MISMATCH");
        if (!destination(getAddress(pool))) fail("FEE_RECIPIENT_MISMATCH");
      } else {
        if (getAddress(pool) !== asset || offset !== 36n) fail("FEE_TRANSFER_ENCODING_MISMATCH");
        const nested = decodeFunctionData({ abi: transferAbi, data });
        if (encodeFunctionData({ abi: transferAbi, ...nested }).toLowerCase() !== data.toLowerCase()
          || nested.args[1] !== 0n) fail("FEE_TRANSFER_ENCODING_MISMATCH");
        if (!destination(getAddress(nested.args[0]))) fail("FEE_RECIPIENT_MISMATCH");
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
      actionIndex = index;
      actionKind = decoded[index]?.functionName ?? null;
      if (input.providerFeeAsset !== asset || input.providerFeeAtomic === null || providerFeeSeen) fail("PROVIDER_FEE_DISCLOSURE_MISMATCH");
      const disclosed = BigInt(input.providerFeeAtomic!);
      if (disclosed <= 0n) fail("PROVIDER_FEE_DISCLOSURE_MISMATCH");
      transfer(next(), asset, basis * 15n / 10_000n, nonRmtDestination);
      providerFeeSeen = true;
    };
    // The retained quotes place a sell-token provider fee after the RMT fee.
    if (input.providerFeeAsset === input.inputAsset) providerTransfer(input.inputAsset);
    // Ordered non-VIP routing. BASIC admits only individually reviewed calls.
    const available = new Set<Address>([input.inputAsset]);
    let routeOutput = input.inputAsset, routeCount = 0;
    while (index < decoded.length) {
      const upcoming = decoded[index];
      if (upcoming.functionName === "POSITIVE_SLIPPAGE") break;
      if (upcoming.functionName === "BASIC" && routeCount > 0 && input.providerFeeAsset === input.outputAsset
        && upcoming.args[1] === basis * 15n / 10_000n) break;
      const route = next();
      if (++routeCount > 32) fail("ROUTE_FILL_LIMIT");
      if (route.functionName === "BASIC") {
        const [token, proportion, target, offset, data] = route.args;
        if (data.slice(0, 10).toLowerCase() === liquidityBookSelector) {
          if (input.runtimeHash !== ZERO_X_PPM_SETTLER_RUNTIME_HASH) fail("ROUTE_RUNTIME_UNSUPPORTED");
          if (getAddress(target) !== liquidityBookRouter) fail("UNSUPPORTED_ROUTE");
          if (offset !== 4n) fail("ROUTE_PATH_INVALID");
          if (proportion <= 0n || proportion > basis) fail("ROUTE_RATE_MISMATCH");
          // Bound dynamic decoding (at most 16 hops) and reject aliases/trailing
          // bytes. Only amountIn is replaced by BASIC, using Settler balance.
          if (data.length > 2 + (292 + 64 * 16) * 2) fail("ROUTE_FILL_LIMIT");
          const nested = decodeFunctionData({ abi: liquidityBookAbi, data });
          if (encodeFunctionData({ abi: liquidityBookAbi, ...nested }).toLowerCase() !== data.toLowerCase()) fail("NONCANONICAL_ACTION");
          const [, , steps, path, recipient, deadline] = nested.args;
          if (getAddress(recipient) !== envelope.settlerTarget) fail("ROUTE_RECIPIENT_MISMATCH");
          if (deadline === 0n || steps.length === 0 || steps.length > 16 || path.length !== steps.length + 1) fail("ROUTE_PATH_INVALID");
          const tokens = path.map(address => getAddress(address));
          if (tokens.some(address => address === zeroAddress || address === ZERO_X_NATIVE_TOKEN)) fail("ROUTE_PATH_INVALID");
          if (tokens[0] !== getAddress(token) || !available.has(tokens[0])) fail("ROUTE_INPUT_MISMATCH");
          if (tokens.some((address, i) => i > 0 && address === tokens[i - 1])) fail("ROUTE_SELF_SWAP");
          // Nonzero bin steps identify factory-resolved LB pairs; zero selects
          // the router's immutable legacy factory. No encoded arbitrary pair,
          // callback, payer, or hook is accepted by this function.
          if (steps.some(step => step > 65_535n)) fail("ROUTE_PATH_INVALID");
          routeOutput = tokens[tokens.length - 1];
          available.add(routeOutput);
          continue;
        }
        if (![toFunctionSelector("deposit()"), toFunctionSelector("withdraw(uint256)")].includes(data.slice(0, 10) as Hex)) fail("UNSUPPORTED_ROUTE");
        const asset = fromZeroXToken(token);
        if (!available.has(asset)) fail("ROUTE_INPUT_MISMATCH");
        if (proportion <= 0n || proportion > basis || getAddress(target) !== WETH || offset !== 4n
          || !/^0x[0-9a-f]{72}$/i.test(data)) fail("NATIVE_WRAP_MISMATCH");
        // BASIC overwrites this entire uint256 word with the balance-relative
        // amount before calling WETH. Its original literal is not authority.
        if (asset === zeroAddress && getAddress(token) === ZERO_X_NATIVE_TOKEN
          && data.slice(0, 10).toLowerCase() === toFunctionSelector("deposit()")) routeOutput = WETH;
        else if (asset === WETH && data.slice(0, 10).toLowerCase() === toFunctionSelector("withdraw(uint256)")) routeOutput = zeroAddress;
        else fail("NATIVE_UNWRAP_MISMATCH");
        available.add(routeOutput);
        continue;
      }
      if (route.functionName === "UNISWAPV3") {
        const [recipient, proportion, path] = route.args;
        const bytes = (path.length - 2) / 2;
        if (getAddress(recipient) !== envelope.settlerTarget) fail("ROUTE_RECIPIENT_MISMATCH");
        if (proportion <= 0n || proportion > basis) fail("ROUTE_RATE_MISMATCH");
        if (bytes < 64 || (bytes - 20) % 44 !== 0 || bytes > 724) fail("ROUTE_PATH_INVALID");
        if (!available.has(getAddress("0x" + path.slice(2, 42)))) fail("ROUTE_INPUT_MISMATCH");
        routeOutput = getAddress("0x" + path.slice(-40));
      } else if (route.functionName === "EKUBOV3" || route.functionName === "UNISWAPV4") {
        if (input.runtimeHash !== ZERO_X_PPM_SETTLER_RUNTIME_HASH) fail("ROUTE_RUNTIME_UNSUPPORTED");
        const [recipient, token, proportion, , hashMul, hashMod, fills, minimum] = route.args;
        if (getAddress(recipient) !== envelope.settlerTarget) fail("ROUTE_RECIPIENT_MISMATCH");
        if (!available.has(fromZeroXToken(token))) fail("ROUTE_INPUT_MISMATCH");
        if (proportion <= 0n || proportion > basis) fail("ROUTE_RATE_MISMATCH");
        const packed = decodeZeroXPackedRoute({ kind: route.functionName, token, fills, hashMul, hashMod, minimum }, fail);
        routeOutput = packed.output;
        packed.tokens.forEach(token => available.add(token));
      } else if (route.functionName === "PANCAKE_INFINITY") {
        if (input.runtimeHash !== ZERO_X_PPM_SETTLER_RUNTIME_HASH) fail("ROUTE_RUNTIME_UNSUPPORTED");
        const [recipient, token, proportion, feeOnTransfer, , , fills] = route.args;
        if (getAddress(recipient) !== envelope.settlerTarget) fail("ROUTE_RECIPIENT_MISMATCH");
        if (fromZeroXToken(token) !== routeOutput) fail("ROUTE_INPUT_MISMATCH");
        if (proportion !== basis) fail("ROUTE_RATE_MISMATCH");
        if (feeOnTransfer) fail("ROUTE_FEE_ON_TRANSFER_UNSUPPORTED");
        // Packed swap instructions contain no transfer recipient. Unknown hooks can
        // introduce fee behavior, so only hook-free reviewed manager IDs are admitted.
        let cursor = 2, sell = token, buy = token, count = 0;
        const take = (bytes: number) => { const end = cursor + bytes * 2; if (end > fills.length) return fail("ROUTE_FILL_TRUNCATED"); const value = fills.slice(cursor, end); cursor = end; return value; };
        while (cursor < fills.length) {
          if (++count > 16) fail("ROUTE_FILL_LIMIT");
          const proportion = BigInt(`0x${take(3)}`); take(20);
          const key = Number.parseInt(take(1), 16);
          if (proportion === 0n || proportion > basis || key > 3 || (count === 1 && key !== 1)) fail("ROUTE_FILL_ENCODING_INVALID");
          if (key === 2) sell = buy;
          if (key === 3) sell = getAddress(`0x${take(20)}`);
          if (key !== 0) buy = getAddress(`0x${take(20)}`);
          if (getAddress(sell) === getAddress(buy)) fail("ROUTE_SELF_SWAP");
          if (getAddress(`0x${take(20)}`) !== zeroAddress) fail("UNSUPPORTED_HOOK");
          if (Number.parseInt(take(1), 16) !== 0) fail("UNSUPPORTED_POOL_MANAGER");
          take(3); take(32);
          if (Number.parseInt(take(3), 16) !== 0) fail("UNSUPPORTED_HOOK");
        }
        if (count === 0) return fail("ROUTE_FILL_ENCODING_INVALID");
        routeOutput = fromZeroXToken(buy);
      } else return fail("UNSUPPORTED_ROUTE");
      available.add(routeOutput);
    }
    if (routeCount === 0) fail("UNSUPPORTED_ROUTE");
    if (routeOutput !== input.outputAsset) fail("OUTPUT_TOKEN_MISMATCH");
    if (decoded[index]?.functionName === "POSITIVE_SLIPPAGE") {
      const surplus = next();
      if (surplus.functionName !== "POSITIVE_SLIPPAGE") return fail("POSITIVE_SLIPPAGE_MISMATCH");
      const [recipient, token, expected, cap] = surplus.args;
      if (!nonRmtDestination(getAddress(recipient)) || fromZeroXToken(token) !== input.outputAsset
        || expected < BigInt(input.expectedOutputAtomic) || cap !== basis) fail("POSITIVE_SLIPPAGE_MISMATCH");
    }
    if (input.providerFeeAsset === input.outputAsset) providerTransfer(input.outputAsset);
    if (providerFeeSeen !== (input.providerFeeAsset !== null)) { actionIndex = null; actionKind = null; fail("PROVIDER_FEE_COUNT_MISMATCH"); }
    if (index !== decoded.length) { actionIndex = index; actionKind = decoded[index]?.functionName ?? null; fail("EXTRA_ACTION"); }
    return fee;
  } catch (cause) {
    if (cause instanceof ExecutionEnvelopeFailure) throw cause;
    return fail("MALFORMED_ACTION");
  }
}
