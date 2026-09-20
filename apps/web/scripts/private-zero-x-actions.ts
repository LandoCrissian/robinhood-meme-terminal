// Diagnostic interpretation only. Never imported by an execution acceptance gate.
import { createHash } from "node:crypto";
import { decodeFunctionData, getAddress, parseAbi, zeroAddress, type Hex } from "viem";
import { RMT_ZERO_X_FEE_TREASURY, ZERO_X_NATIVE_TOKEN } from "../lib/vnext/zero-x-settlement";
import { RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER } from "../lib/vnext/zero-x-authority";
import { ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH } from "../lib/server/vnext-zero-x-execution-decoder";
import type { ZeroXExecutableInspection } from "../lib/server/vnext-zero-x-firm-quote-verifier";

export const CANDIDATE_SEMANTIC_HASH = "0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f";
export const MAX_ACTIONS = 64;
const abi = parseAbi([
  "function exec(address operator,address token,uint256 amount,address target,bytes data)",
  "function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag)",
  "function BASIC(address sellToken,uint256 numerator,address pool,uint256 offset,bytes data)",
  "function TRANSFER_FROM(address recipient,((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,bytes sig)",
  "function NATIVE_CHECK(uint256 deadline,uint256 msgValue)",
  "function CHECK_SLIPPAGE(bool transferExactLimit)",
  "function POSITIVE_SLIPPAGE(address recipient,address token,uint256 expectedAmount,uint256 maxNumerator)",
  "function UNISWAPV3(address recipient,uint256 numerator,bytes path,uint256 minimum)",
  "function UNISWAPV2(address recipient,address sellToken,uint256 numerator,address pool,uint24 swapInfo,uint256 minimum)",
  "function VELODROME(address recipient,uint256 numerator,address pool,uint24 swapInfo,uint256 minimum)",
  "function UNISWAPV4(address recipient,address sellToken,uint256 numerator,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 minimum)",
  "function EKUBOV3(address recipient,address sellToken,uint256 numerator,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 minimum)",
  "function PANCAKE_INFINITY(address recipient,address sellToken,uint256 numerator,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 minimum)",
  "function transfer(address recipient,uint256 amount)",
  "function transferFrom(address from,address recipient,uint256 amount)",
  "function approve(address spender,uint256 amount)",
  "function deposit()", "function withdraw(uint256 amount)"
]);
export type Roles = { sell: string; buy: string; user: string; settler: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const digest = (value: string) => createHash("sha256").update(value.toLowerCase()).digest("hex");
export function addressRole(address: string, roles: Roles): string {
  if (same(address, roles.user)) return same(address, RMT_ZERO_X_FEE_TREASURY) ? "USER_RECIPIENT_AND_RMT_TREASURY" : "USER_RECIPIENT";
  if (same(address, RMT_ZERO_X_FEE_TREASURY)) return "RMT_TREASURY";
  if (same(address, roles.settler)) return "QUOTED_SETTLER";
  if (same(address, RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER)) return "CANONICAL_ALLOWANCEHOLDER";
  if (same(address, ZERO_X_NATIVE_TOKEN)) return "NATIVE_ETH";
  if (same(address, zeroAddress)) return "ZERO_SENTINEL";
  if (same(address, roles.sell)) return "SELL_TOKEN";
  if (same(address, roles.buy)) return "BUY_TOKEN";
  return `ROLE_HASH_${digest(address)}`;
}
export type StructuralAction = Record<string, string | number | boolean | null>;
// Structural summaries of the reviewed source's packed fills. Never acceptance
// logic: no hook data, price caps, arbitrary parameters or raw fills are emitted.
function packedRouteSummary(fills: Hex, pancake: boolean) {
  let cursor = 2, count = 0, hooks = false;
  const managers = new Set<string>();
  const take = (bytes: number) => {
    const end = cursor + bytes * 2;
    if (end > fills.length) throw new Error("PARTIAL_PACKED_ROUTE");
    const value = fills.slice(cursor, end); cursor = end; return value;
  };
  while (cursor < fills.length) {
    if (++count > 64) throw new Error("PACKED_ROUTE_LIMIT");
    take(3); take(20);
    const key = Number.parseInt(take(1), 16);
    if (key > 3 || count === 1 && key !== 1) throw new Error("UNKNOWN_PACKING");
    if (key === 3) take(20);
    if (key !== 0) take(20);
    if (!pancake) take(6);
    const hook = take(20);
    if (BigInt(`0x${hook}`) !== 0n) hooks = true;
    // Always consume bytes, including after the first observed hook.
    if (pancake) {
      const manager = Number.parseInt(take(1), 16);
      managers.add(manager === 0 ? "PANCAKE_CL" : manager === 1 ? "PANCAKE_BIN" : "UNKNOWN_MANAGER");
      take(3); take(32);
    } else managers.add("RUNTIME_UNISWAPV4_MANAGER");
    const length = Number.parseInt(take(3), 16);
    if (length) hooks = true;
    take(length);
  }
  if (!count) throw new Error("EMPTY_PACKED_ROUTE");
  return { fillCount: count, hookPresent: hooks, poolManagerRole: [...managers].sort().join("+") };
}
function scalar(value: bigint, roles: Roles) {
  // A known numeric ABI slot may itself contain a wallet-shaped value.
  return value === BigInt(roles.user) ? "USER_RECIPIENT_NUMERIC_REDACTED" : value.toString();
}
export function inspectActions(envelope: ZeroXExecutableInspection, roles: Roles, runtimeHash: string | null) {
  const denominator = runtimeHash === ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH ? 10_000n
    : runtimeHash === CANDIDATE_SEMANTIC_HASH ? 1_000_000n : null;
  const sourceSemantics = denominator === 10_000n ? "OLD_BPS" : denominator ? "REVIEWED_PPM" : "UNKNOWN_RUNTIME";
  let data = envelope.data;
  let settler = envelope.target;
  if (same(envelope.target, RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER)) {
    const holder = decodeFunctionData({ abi, data });
    if (holder.functionName !== "exec") throw new Error("INSPECTION_ENVELOPE_UNSUPPORTED");
    settler = getAddress(holder.args[3]);
    data = holder.args[4];
  }
  const outer = decodeFunctionData({ abi, data });
  if (outer.functionName !== "execute") throw new Error("INSPECTION_ENVELOPE_UNSUPPORTED");
  roles = { ...roles, settler };
  const [slippage, actions] = outer.args;
  const records: StructuralAction[] = [];
  for (const [index, action] of actions.slice(0, MAX_ACTIONS).entries()) {
    const r: StructuralAction = { index, actionKind: "UNKNOWN", selector: /^0x[0-9a-f]{8}/i.test(action) ? action.slice(0, 10).toLowerCase() : null,
      semanticFamily: "UNKNOWN", sourceSemantics, semanticsComplete: false, tokenRole: "UNKNOWN", recipientRole: "UNKNOWN",
      amountMode: "UNKNOWN", denominator: denominator?.toString() ?? null, numerator: null, amountLiteral: null,
      rounding: "UNKNOWN", balanceBasis: "UNKNOWN", targetRole: "UNKNOWN", affectsSellBalance: "UNKNOWN", affectsBuyBalance: "UNKNOWN",
      hookPresent: "UNKNOWN", poolManagerRole: "UNKNOWN", feeAttribution: "NOT_CLASSIFIED" };
    const proportional = (n: bigint, token: string) => {
      r.amountMode = "PROPORTIONAL_TO_CURRENT_BALANCE"; r.numerator = scalar(n, roles); r.rounding = denominator ? "FLOOR" : "UNKNOWN";
      r.balanceBasis = "SETTLER_CURRENT_NOT_INDEPENDENTLY_KNOWN"; r.tokenRole = addressRole(token, roles);
      if (same(token, roles.sell)) r.affectsSellBalance = "YES";
    };
    const transfer = (token: string, to: string) => {
      r.tokenRole = addressRole(token, roles); r.recipientRole = addressRole(to, roles);
      r.affectsSellBalance = same(token, roles.sell) || same(token, ZERO_X_NATIVE_TOKEN) && same(roles.sell, zeroAddress) ? "YES" : "UNKNOWN";
      r.affectsBuyBalance = same(token, roles.buy) || same(token, ZERO_X_NATIVE_TOKEN) && same(roles.buy, zeroAddress) ? "YES" : "UNKNOWN";
      r.feeAttribution = same(to, RMT_ZERO_X_FEE_TREASURY) ? "RMT_FEE_CANDIDATE_NOT_PROVEN" : "UNATTRIBUTED_TRANSFER_NOT_PROVIDER_PROVEN";
    };
    try {
      const decoded = decodeFunctionData({ abi, data: action });
      r.actionKind = decoded.functionName;
      r.selector = action.slice(0, 10).toLowerCase(); // Only a recognized, fixed ABI selector.
      if (decoded.functionName === "BASIC") {
        const [token, n, target, offset, nested] = decoded.args;
        r.semanticFamily = "GENERIC_CALL"; r.targetRole = addressRole(target, roles); r.patchOffset = scalar(offset, roles);
        r.nestedBytes = (nested.length - 2) / 2;
        const noPatch = same(token, zeroAddress), native = same(token, ZERO_X_NATIVE_TOKEN);
        if (!noPatch) proportional(n, token);
        else { r.tokenRole = "ZERO_SENTINEL_NOT_NATIVE"; r.nativeCallValue = "0"; }
        if (native && nested === "0x" && offset === 0n) {
          r.semanticFamily = "NATIVE_TRANSFER"; transfer(token, target); r.semanticsComplete = denominator !== null;
          r.arithmetic = "UINT256_WRAPPING_MULTIPLY_THEN_FLOOR_DIVIDE";
        } else {
          try {
            const inner = decodeFunctionData({ abi, data: nested });
            r.nestedKind = inner.functionName;
            if (inner.functionName === "transfer" && nested.length === 138 && (noPatch && offset === 0n || same(token, target) && offset === 36n)) {
              r.semanticFamily = "ERC20_TRANSFER_CALL_INTENT"; transfer(target, inner.args[0]); r.tokenBehaviorVerified = false;
              r.amountLiteral = scalar(inner.args[1], roles); r.literalOverwritten = !noPatch;
              if (noPatch) { r.amountMode = "ABSOLUTE"; r.rounding = "NONE"; r.balanceBasis = "ENCODED_LITERAL"; r.denominator = null; }
              r.semanticsComplete = (noPatch || denominator !== null) && (same(target, roles.sell) || same(target, roles.buy));
            } else if (inner.functionName === "withdraw" && noPatch && offset === 0n) {
              r.semanticFamily = "POSSIBLE_UNWRAP_TARGET_NOT_ATTESTED"; r.amountLiteral = scalar(inner.args[0], roles);
            } else { r.recipientRole = "UNKNOWN_PATCH_OR_TARGET_SEMANTICS"; }
          } catch { r.nestedKind = `UNKNOWN_SELECTOR_${digest(nested.slice(0, 10))}`; }
        }
      } else if (decoded.functionName === "TRANSFER_FROM") {
        const [to, permit, sig] = decoded.args;
        r.semanticFamily = "INPUT_ACQUISITION"; transfer(permit.permitted.token, to); r.feeAttribution = "NOT_CLASSIFIED";
        r.sourceBalance = "USER_CURRENT"; r.destinationBalance = addressRole(to, roles);
        r.amountLiteral = scalar(permit.permitted.amount, roles); r.signaturePresent = sig !== "0x";
        r.validDispatchPosition = index === 0; r.nonceZero = permit.nonce === 0n;
        const delta = 2n ** 256n - 1n - permit.permitted.amount;
        if (denominator && delta < denominator) {
          r.amountMode = "PROPORTIONAL_TO_CURRENT_BALANCE"; r.numerator = scalar(denominator - delta, roles);
          r.balanceBasis = "USER_CURRENT_NOT_INDEPENDENTLY_KNOWN"; r.rounding = "FLOOR";
        } else if (denominator) { r.amountMode = "ABSOLUTE"; r.rounding = "NONE"; r.balanceBasis = "ENCODED_LITERAL"; }
        r.semanticsComplete = denominator !== null && index === 0 && sig === "0x" && permit.nonce === 0n;
      } else if (decoded.functionName === "NATIVE_CHECK") {
        r.semanticFamily = "TRANSACTION_VALUE_UPPER_BOUND_NOT_BALANCE_CHECK"; r.amountMode = "ABSOLUTE";
        r.amountLiteral = scalar(decoded.args[1], roles); r.deadlineLiteral = scalar(decoded.args[0], roles); r.rounding = "NONE"; r.semanticsComplete = true;
      } else if (decoded.functionName === "CHECK_SLIPPAGE") {
        r.semanticFamily = "EARLY_MINIMUM_TRANSFER_CLEARS_FINAL_CHECK";
        r.recipientRole = addressRole(slippage.recipient, roles); r.tokenRole = addressRole(slippage.buyToken, roles);
        r.transferExactLimit = decoded.args[0]; r.minimumLiteral = scalar(slippage.minAmountOut, roles);
        r.amountMode = decoded.args[0] ? "ABSOLUTE" : "ALL_BALANCE"; r.semanticsComplete = true;
      } else if (decoded.functionName === "POSITIVE_SLIPPAGE") {
        const [to, token, expected, n] = decoded.args; transfer(token, to); proportional(n, token);
        r.semanticFamily = "CONDITIONAL_CAPPED_TRANSFER"; r.amountMode = "UNKNOWN";
        r.formula = "IF_BALANCE_GT_EXPECTED_MIN_EXCESS_AND_PROPORTIONAL_CAP"; r.amountLiteral = scalar(expected, roles);
        r.arithmetic = "UINT256_WRAPPING_CAP_MULTIPLY_THEN_FLOOR_DIVIDE";
        r.semanticsComplete = denominator !== null;
      } else if (decoded.functionName === "UNISWAPV3") {
        const [to, n, path, minimum] = decoded.args;
        r.semanticFamily = "ROUTING_OPAQUE_PATH"; r.recipientRole = addressRole(to, roles); r.numerator = scalar(n, roles);
        r.amountMode = "PROPORTIONAL_TO_CURRENT_BALANCE"; r.rounding = denominator ? "FLOOR" : "UNKNOWN";
        r.balanceBasis = "SETTLER_CURRENT_PATH_TOKEN_UNKNOWN"; r.pathBytes = (path.length - 2) / 2; r.minimumLiteral = scalar(minimum, roles);
        if (Number(r.pathBytes) >= 64 && (Number(r.pathBytes) - 20) % 44 === 0 && Number(r.pathBytes) <= 724) {
          const first = `0x${path.slice(2, 42)}`;
          const last = `0x${path.slice(-40)}`;
          r.tokenRole = addressRole(first, roles); r.outputTokenRole = addressRole(last, roles);
          r.balanceBasis = "SETTLER_CURRENT_PATH_INPUT";
          r.affectsSellBalance = same(first, roles.sell) ? "YES" : "UNKNOWN";
          r.affectsBuyBalance = same(last, roles.buy) ? "YES" : "UNKNOWN";
          r.hookPresent = false; r.poolManagerRole = "RUNTIME_V3_FORK_SELECTION";
          r.hopCount = (Number(r.pathBytes) - 20) / 44;
        }
      } else if (decoded.functionName === "VELODROME") {
        const [to, n, pool, , minimum] = decoded.args;
        r.semanticFamily = "ROUTING_POOL_TOKEN_UNKNOWN"; r.recipientRole = addressRole(to, roles);
        r.targetRole = addressRole(pool, roles); r.numerator = scalar(n, roles); r.minimumLiteral = scalar(minimum, roles);
      } else if (["UNISWAPV2", "UNISWAPV4", "EKUBOV3", "PANCAKE_INFINITY"].includes(decoded.functionName)) {
        const args = decoded.args as readonly unknown[];
        r.semanticFamily = "ROUTING_PARTIAL"; r.recipientRole = addressRole(args[0] as string, roles);
        proportional(args[2] as bigint, args[1] as string);
        if (decoded.functionName === "UNISWAPV2") {
          r.targetRole = addressRole(args[3] as string, roles);
          const swapInfo = Number(args[4]);
          r.swapInfo = swapInfo; r.zeroForOne = (swapInfo & 1) === 1;
          r.feeOnTransfer = (swapInfo & 2) !== 0; r.poolFeeBps = swapInfo >>> 8;
          r.hookPresent = false; r.poolManagerRole = "V2_PAIR_TARGET";
          r.outputTokenRole = "POOL_OUTPUT_TOKEN_NOT_IN_CALLDATA";
        } else if (decoded.functionName === "UNISWAPV4" || decoded.functionName === "PANCAKE_INFINITY") {
          r.feeOnTransfer = args[3] as boolean;
          try { Object.assign(r, packedRouteSummary(args[6] as Hex, decoded.functionName === "PANCAKE_INFINITY")); }
          catch { r.packedInspection = "INCOMPLETE"; }
        }
        r.minimumLiteral = scalar(args.at(-1) as bigint, roles);
        if (args[2] === 0n) r.balanceBasis = "UNKNOWN_ZERO_NUMERATOR_ROUTE_SPECIAL_CASE";
      }
    } catch { r.semanticFamily = "MALFORMED_OR_UNKNOWN"; }
    if (!denominator) r.semanticsComplete = false;
    records.push(r);
  }
  return { settler, actionCount: actions.length, omitted: Math.max(0, actions.length - records.length), records,
    final: { phase: "IMPLICIT_POST_ACTIONS", recipientRole: addressRole(slippage.recipient, roles), tokenRole: addressRole(slippage.buyToken, roles),
      declaredMinimum: scalar(slippage.minAmountOut, roles), protectionVerified: false,
      amountMode: "ALL_BALANCE", condition: "AFTER_ALL_ACTIONS_UNLESS_EXPLICIT_EARLY_CHECK_CLEARED", feeProof: false } };
}
