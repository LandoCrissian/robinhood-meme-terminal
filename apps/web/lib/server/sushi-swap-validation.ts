import {
  decodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import { SUSHI_NATIVE_TOKEN, SUSHI_QUOTE_SLIPPAGE_BPS, SUSHI_RED_SNWAPPER } from "../sushi";

export const SUSHI_RED_SNWAPPER_CODE_HASH = "0x4b299d0674c86f701924420b3c90e4eb8efcc49f7865cc9680ee631ec7048b97" as Hex;
export const SUSHI_ROUTE_EXECUTOR = getAddress("0x0e867974275cd31c25015c2753c9d75f9f355379");
export const SUSHI_ROUTE_EXECUTOR_CODE_HASH = "0x57d45a1dce631a859bd1780826e0fbb9a7489650453406e0dc593724eca6cb6b" as Hex;
export const SUSHI_ROUTE_EXECUTOR_ENTRYPOINT = "0x6be92b89" as Hex;

export const sushiRedSnwapperAbi = [{
  type: "function",
  name: "snwap",
  stateMutability: "payable",
  inputs: [
    { name: "tokenIn", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountOutMin", type: "uint256" },
    { name: "executor", type: "address" },
    { name: "executorData", type: "bytes" }
  ],
  outputs: [{ name: "amountOut", type: "uint256" }]
}] as const;

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
  executorData: Hex;
  executable: true;
  onchainDeadline: false;
};

export async function auditSushiSwapCandidate(
  params: {
    token: Address;
    sender?: Address;
    recipient: Address;
    side: "buy" | "sell";
    amountIn: bigint;
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
  if (!sameAddress(sender, params.sender ?? params.recipient)) throw new Error("Sushi changed the transaction sender.");
  if (!sameAddress(router, SUSHI_RED_SNWAPPER)) throw new Error("Sushi returned an unapproved execution router.");
  if (BigInt(payload.amountIn) !== params.amountIn) throw new Error("Sushi changed the executable input amount.");

  const expectedTokenIn = params.side === "buy" ? SUSHI_NATIVE_TOKEN : params.token;
  const expectedTokenOut = params.side === "buy" ? params.token : SUSHI_NATIVE_TOKEN;
  const decoded = (() => {
    try {
      return decodeFunctionData({ abi: sushiRedSnwapperAbi, data: payload.tx.data as Hex });
    } catch {
      throw new Error("Sushi returned undecodable execution calldata.");
    }
  })();
  if (decoded.functionName !== "snwap") throw new Error("Sushi returned an unsupported execution function.");

  const [tokenIn, calldataAmountIn, recipient, tokenOut, minimumOut, executor, executorData] = decoded.args;
  if (!sameAddress(tokenIn, expectedTokenIn)) throw new Error("Sushi changed the input token.");
  if (calldataAmountIn !== params.amountIn) throw new Error("Sushi calldata changed the input amount.");
  if (!sameAddress(recipient, params.recipient)) throw new Error("Sushi changed the output recipient.");
  if (!sameAddress(tokenOut, expectedTokenOut)) throw new Error("Sushi changed the output token.");
  if (!sameAddress(executor, SUSHI_ROUTE_EXECUTOR)) throw new Error("Sushi returned an unapproved route executor.");
  if (!executorData.toLowerCase().startsWith(SUSHI_ROUTE_EXECUTOR_ENTRYPOINT)) throw new Error("Sushi returned an unsupported executor entrypoint.");

  const assumedAmountOut = BigInt(payload.assumedAmountOut);
  const expectedMinimumOut = assumedAmountOut * BigInt(10_000 - SUSHI_QUOTE_SLIPPAGE_BPS) / 10_000n;
  if (assumedAmountOut <= 0n || expectedMinimumOut <= 0n || minimumOut !== expectedMinimumOut) {
    throw new Error("Sushi calldata changed the minimum received amount.");
  }

  const value = BigInt(payload.tx.value);
  const expectedValue = params.side === "buy" ? params.amountIn : 0n;
  if (value !== expectedValue) throw new Error("Sushi returned an invalid native transaction value.");

  const [routerCodeHash, executorCodeHash] = await Promise.all([
    dependencies.codeHash(SUSHI_RED_SNWAPPER),
    dependencies.codeHash(SUSHI_ROUTE_EXECUTOR)
  ]);
  if (routerCodeHash.toLowerCase() !== SUSHI_RED_SNWAPPER_CODE_HASH) throw new Error("Sushi router bytecode is not approved.");
  if (executorCodeHash.toLowerCase() !== SUSHI_ROUTE_EXECUTOR_CODE_HASH) throw new Error("Sushi executor bytecode is not approved.");

  return {
    router,
    executor: getAddress(executor),
    sender,
    recipient: getAddress(recipient),
    tokenIn: getAddress(tokenIn),
    tokenOut: getAddress(tokenOut),
    amountIn: params.amountIn,
    assumedAmountOut,
    minimumOut,
    value,
    calldata: payload.tx.data as Hex,
    executorData,
    executable: true,
    onchainDeadline: false
  };
}

export function hashSushiContractCode(code: Hex) {
  if (code === "0x") throw new Error("Sushi contract bytecode is unavailable.");
  return keccak256(code);
}
