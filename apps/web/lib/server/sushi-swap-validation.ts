import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { z } from "zod";
import { SUSHI_QUOTE_SLIPPAGE_BPS, SUSHI_RED_SNWAPPER } from "../sushi";
import {
  assertSushiSwapCalldata,
  SUSHI_RED_SNWAPPER_CODE_HASH,
  SUSHI_ROUTE_EXECUTOR,
  SUSHI_ROUTE_EXECUTOR_CODE_HASH
} from "../vnext/sushi-authorization-codec";

export {
  SUSHI_RED_SNWAPPER_CODE_HASH,
  SUSHI_ROUTE_EXECUTOR,
  SUSHI_ROUTE_EXECUTOR_CODE_HASH,
  SUSHI_ROUTE_EXECUTOR_ENTRYPOINT,
  sushiRedSnwapperAbi
} from "../vnext/sushi-authorization-codec";

const decimalString = z.string().regex(/^\d+$/);
const hexData = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/);
const address = z.string().refine(isAddress);
const swapResponseSchema = z.object({
  status: z.literal("Success"),
  amountIn: decimalString,
  assumedAmountOut: decimalString,
  tx: z.object({
    from: address,
    to: address,
    data: hexData,
    value: decimalString
  }).passthrough()
}).passthrough();

function sameAddress(left: Address | string, right: Address | string) {
  return left.toLowerCase() === right.toLowerCase();
}

export type SushiSwapAudit = {
  router: Address;
  executor: Address;
  sender: Address;
  recipient: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  assumedAmountOut: bigint;
  minimumOut: bigint;
  value: bigint;
  calldata: Hex;
  executable: true;
  onchainDeadline: false;
};

export async function auditSushiAssetSwapCandidate(
  params: {
    inputAsset: Address;
    outputAsset: Address;
    recipient: Address;
    amountIn: bigint;
    protectedOutputFloorAtomic?: bigint;
  },
  response: unknown,
  dependencies: { codeHash: (address: Address) => Promise<Hex> }
): Promise<SushiSwapAudit> {
  const parsed = swapResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("Sushi returned an invalid executable swap response.");
  if (params.amountIn <= 0n) throw new Error("Sushi execution requires a positive input amount.");

  const payload = parsed.data;
  const sender = getAddress(payload.tx.from);
  const router = getAddress(payload.tx.to);
  if (!sameAddress(sender, params.recipient)) throw new Error("Sushi changed the transaction sender.");
  if (!sameAddress(router, SUSHI_RED_SNWAPPER)) throw new Error("Sushi returned an unapproved execution router.");
  if (BigInt(payload.amountIn) !== params.amountIn) throw new Error("Sushi changed the executable input amount.");

  const assumedAmountOut = BigInt(payload.assumedAmountOut);
  const expectedMinimumOut = assumedAmountOut * BigInt(10_000 - SUSHI_QUOTE_SLIPPAGE_BPS) / 10_000n;
  if (
    assumedAmountOut <= 0n
    || expectedMinimumOut <= 0n
    || expectedMinimumOut < (params.protectedOutputFloorAtomic ?? 0n)
  ) {
    throw new Error("Sushi executable minimum received moved below the protected floor.");
  }

  const value = BigInt(payload.tx.value);
  const calldata = assertSushiSwapCalldata(payload.tx.data as Hex, {
    inputAsset: params.inputAsset,
    outputAsset: params.outputAsset,
    inputAmountAtomic: params.amountIn.toString(),
    protectedOutputAtomic: expectedMinimumOut.toString(),
    recipient: params.recipient,
    transactionValueAtomic: value.toString()
  });

  const [routerCodeHash, executorCodeHash] = await Promise.all([
    dependencies.codeHash(SUSHI_RED_SNWAPPER),
    dependencies.codeHash(SUSHI_ROUTE_EXECUTOR)
  ]);
  if (routerCodeHash.toLowerCase() !== SUSHI_RED_SNWAPPER_CODE_HASH) throw new Error("Sushi router bytecode is not approved.");
  if (executorCodeHash.toLowerCase() !== SUSHI_ROUTE_EXECUTOR_CODE_HASH) throw new Error("Sushi executor bytecode is not approved.");

  return {
    router,
    executor: calldata.executor,
    sender,
    recipient: calldata.recipient,
    tokenIn: calldata.tokenIn,
    tokenOut: calldata.tokenOut,
    amountIn: params.amountIn,
    assumedAmountOut,
    minimumOut: expectedMinimumOut,
    value,
    calldata: payload.tx.data as Hex,
    executable: true,
    onchainDeadline: false
  };
}

export function auditSushiSwapCandidate(
  params: { token: Address; recipient: Address; side: "buy" | "sell"; amountIn: bigint },
  response: unknown,
  dependencies: { codeHash: (address: Address) => Promise<Hex> }
) {
  return auditSushiAssetSwapCandidate({
    inputAsset: params.side === "buy" ? getAddress("0x0000000000000000000000000000000000000000") : params.token,
    outputAsset: params.side === "buy" ? params.token : getAddress("0x0000000000000000000000000000000000000000"),
    recipient: params.recipient,
    amountIn: params.amountIn
  }, response, dependencies);
}

export function hashSushiContractCode(code: Hex) {
  if (code === "0x") throw new Error("Sushi contract bytecode is unavailable.");
  return keccak256(code);
}
