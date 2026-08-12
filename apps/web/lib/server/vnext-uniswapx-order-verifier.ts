import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  hashStruct,
  hashTypedData,
  isAddress,
  isHex,
  keccak256,
  recoverAddress,
  type Address,
  type Hex
} from "viem";
import type { VNextProviderQuoteRequest } from "./vnext-provider-adapter";

export const ROBINHOOD_UNISWAPX_V3_REACTOR = getAddress("0x000000007A1C8e570011EeDF86A2A35593013cBA");
export const ROBINHOOD_UNISWAP_PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");

const MAX_ENCODED_ORDER_BYTES = 32_768;
const MAX_CURVE_POINTS = 16;

const ORDER_INFO_COMPONENTS = [
  { name: "reactor", type: "address" },
  { name: "swapper", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "additionalValidationContract", type: "address" },
  { name: "additionalValidationData", type: "bytes" }
] as const;

const CURVE_COMPONENTS = [
  { name: "relativeBlocks", type: "uint256" },
  { name: "relativeAmounts", type: "int256[]" }
] as const;

const INPUT_COMPONENTS = [
  { name: "token", type: "address" },
  { name: "startAmount", type: "uint256" },
  { name: "curve", type: "tuple", components: CURVE_COMPONENTS },
  { name: "maxAmount", type: "uint256" },
  { name: "adjustmentPerGweiBaseFee", type: "uint256" }
] as const;

const OUTPUT_COMPONENTS = [
  { name: "token", type: "address" },
  { name: "startAmount", type: "uint256" },
  { name: "curve", type: "tuple", components: CURVE_COMPONENTS },
  { name: "recipient", type: "address" },
  { name: "minAmount", type: "uint256" },
  { name: "adjustmentPerGweiBaseFee", type: "uint256" }
] as const;

const COSIGNER_DATA_COMPONENTS = [
  { name: "decayStartBlock", type: "uint256" },
  { name: "exclusiveFiller", type: "address" },
  { name: "exclusivityOverrideBps", type: "uint256" },
  { name: "inputOverride", type: "uint256" },
  { name: "outputOverrides", type: "uint256[]" }
] as const;

const V3_DUTCH_ORDER_ABI = [{
  name: "order",
  type: "tuple",
  components: [
    { name: "info", type: "tuple", components: ORDER_INFO_COMPONENTS },
    { name: "cosigner", type: "address" },
    { name: "startingBaseFee", type: "uint256" },
    { name: "baseInput", type: "tuple", components: INPUT_COMPONENTS },
    { name: "baseOutputs", type: "tuple[]", components: OUTPUT_COMPONENTS },
    { name: "cosignerData", type: "tuple", components: COSIGNER_DATA_COMPONENTS },
    { name: "cosignature", type: "bytes" }
  ]
}] as const;

const V3_DUTCH_ORDER_TYPES = {
  V3DutchOrder: [
    { name: "info", type: "OrderInfo" },
    { name: "cosigner", type: "address" },
    { name: "startingBaseFee", type: "uint256" },
    { name: "baseInput", type: "V3DutchInput" },
    { name: "baseOutputs", type: "V3DutchOutput[]" }
  ],
  OrderInfo: [
    { name: "reactor", type: "address" },
    { name: "swapper", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "additionalValidationContract", type: "address" },
    { name: "additionalValidationData", type: "bytes" }
  ],
  V3DutchInput: [
    { name: "token", type: "address" },
    { name: "startAmount", type: "uint256" },
    { name: "curve", type: "NonlinearDutchDecay" },
    { name: "maxAmount", type: "uint256" },
    { name: "adjustmentPerGweiBaseFee", type: "uint256" }
  ],
  V3DutchOutput: [
    { name: "token", type: "address" },
    { name: "startAmount", type: "uint256" },
    { name: "curve", type: "NonlinearDutchDecay" },
    { name: "recipient", type: "address" },
    { name: "minAmount", type: "uint256" },
    { name: "adjustmentPerGweiBaseFee", type: "uint256" }
  ],
  NonlinearDutchDecay: [
    { name: "relativeBlocks", type: "uint256" },
    { name: "relativeAmounts", type: "int256[]" }
  ]
} as const;

const PERMIT_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "V3DutchOrder" }
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" }
  ],
  ...V3_DUTCH_ORDER_TYPES
} as const;

export const ROBINHOOD_UNISWAPX_V3_ORDER_TYPES = V3_DUTCH_ORDER_TYPES;
export const ROBINHOOD_UNISWAPX_V3_PERMIT_TYPES = PERMIT_WITNESS_TYPES;

export class UniswapXV3OrderVerificationError extends Error {}

function fail(message: string): never {
  throw new UniswapXV3OrderVerificationError(message);
}

function sameAddress(left: Address, right: Address) {
  return getAddress(left) === getAddress(right);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bigintValue(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) return BigInt(value);
  if (isObject(value) && value.type === "BigNumber" && typeof value.hex === "string" && /^0x[0-9a-fA-F]+$/.test(value.hex)) {
    return BigInt(value.hex);
  }
  return null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function hasExactTypedDataTypes(value: unknown) {
  if (!isObject(value)) return false;
  const expectedEntries = Object.entries(PERMIT_WITNESS_TYPES);
  if (!exactKeys(value, expectedEntries.map(([name]) => name))) return false;
  return expectedEntries.every(([name, expectedFields]) => {
    const actualFields = value[name];
    return Array.isArray(actualFields)
      && actualFields.length === expectedFields.length
      && expectedFields.every((field, index) => {
        const actual = actualFields[index];
        return isObject(actual)
          && exactKeys(actual, ["name", "type"])
          && actual.name === field.name
          && actual.type === field.type;
      });
  });
}

function validateCurve(curve: { relativeBlocks: bigint; relativeAmounts: readonly bigint[] }, label: string) {
  const pointCount = curve.relativeAmounts.length;
  if (pointCount < 1 || pointCount > MAX_CURVE_POINTS) fail(`${label} has an invalid point count.`);
  if (pointCount < MAX_CURVE_POINTS && curve.relativeBlocks >> BigInt(pointCount * 16) !== 0n) {
    fail(`${label} has non-canonical packed blocks.`);
  }
  let previous = 0;
  for (let index = 0; index < pointCount; index += 1) {
    const relativeBlock = Number((curve.relativeBlocks >> BigInt(index * 16)) & 0xffffn);
    if (relativeBlock <= previous) fail(`${label} blocks are not strictly increasing.`);
    previous = relativeBlock;
  }
}

function orderHash(order: DecodedOrder) {
  return hashStruct({
    primaryType: "V3DutchOrder",
    types: V3_DUTCH_ORDER_TYPES,
    data: {
      info: order.info,
      cosigner: order.cosigner,
      startingBaseFee: order.startingBaseFee,
      baseInput: order.baseInput,
      baseOutputs: order.baseOutputs
    }
  });
}

function cosignatureHash(order: DecodedOrder, unsignedOrderHash: Hex) {
  const encodedCosignerData = encodeAbiParameters(
    [{ type: "tuple", components: COSIGNER_DATA_COMPONENTS }],
    [order.cosignerData]
  );
  return keccak256(encodePacked(
    ["bytes32", "uint256", "bytes"],
    [unsignedOrderHash, 4_663n, encodedCosignerData]
  ));
}

function canonicalPermitData(order: DecodedOrder) {
  return {
    domain: {
      name: "Permit2" as const,
      chainId: 4_663 as const,
      verifyingContract: ROBINHOOD_UNISWAP_PERMIT2
    },
    types: PERMIT_WITNESS_TYPES,
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: { token: getAddress(order.baseInput.token), amount: order.baseInput.maxAmount.toString() },
      spender: getAddress(order.info.reactor),
      nonce: order.info.nonce.toString(),
      deadline: order.info.deadline.toString(),
      witness: {
        info: {
          reactor: getAddress(order.info.reactor),
          swapper: getAddress(order.info.swapper),
          nonce: order.info.nonce.toString(),
          deadline: order.info.deadline.toString(),
          additionalValidationContract: getAddress(order.info.additionalValidationContract),
          additionalValidationData: order.info.additionalValidationData
        },
        cosigner: getAddress(order.cosigner),
        startingBaseFee: order.startingBaseFee.toString(),
        baseInput: {
          token: getAddress(order.baseInput.token),
          startAmount: order.baseInput.startAmount.toString(),
          curve: {
            relativeBlocks: order.baseInput.curve.relativeBlocks.toString(),
            relativeAmounts: order.baseInput.curve.relativeAmounts.map((amount) => amount.toString())
          },
          maxAmount: order.baseInput.maxAmount.toString(),
          adjustmentPerGweiBaseFee: order.baseInput.adjustmentPerGweiBaseFee.toString()
        },
        baseOutputs: order.baseOutputs.map((output) => ({
          token: getAddress(output.token),
          startAmount: output.startAmount.toString(),
          curve: {
            relativeBlocks: output.curve.relativeBlocks.toString(),
            relativeAmounts: output.curve.relativeAmounts.map((amount) => amount.toString())
          },
          recipient: getAddress(output.recipient),
          minAmount: output.minAmount.toString(),
          adjustmentPerGweiBaseFee: output.adjustmentPerGweiBaseFee.toString()
        }))
      }
    }
  };
}

function verifyPermitData(permitData: unknown, order: DecodedOrder, unsignedOrderHash: Hex) {
  if (!isObject(permitData) || !exactKeys(permitData, ["domain", "types", "values"])) {
    fail("The Permit2 authorization payload is missing or malformed.");
  }
  const domain = permitData.domain;
  const values = permitData.values;
  if (
    !isObject(domain)
    || !exactKeys(domain, ["name", "chainId", "verifyingContract"])
    || domain.name !== "Permit2"
    || bigintValue(domain.chainId) !== 4_663n
    || typeof domain.verifyingContract !== "string"
    || !isAddress(domain.verifyingContract)
    || !sameAddress(domain.verifyingContract, ROBINHOOD_UNISWAP_PERMIT2)
    || !hasExactTypedDataTypes(permitData.types)
    || !isObject(values)
    || !exactKeys(values, ["permitted", "spender", "nonce", "deadline", "witness"])
  ) fail("The Permit2 authorization domain or types changed.");

  const permitted = values.permitted;
  if (
    !isObject(permitted)
    || !exactKeys(permitted, ["token", "amount"])
    || typeof permitted.token !== "string"
    || !isAddress(permitted.token)
    || !sameAddress(permitted.token, order.baseInput.token)
    || bigintValue(permitted.amount) !== order.baseInput.maxAmount
    || typeof values.spender !== "string"
    || !isAddress(values.spender)
    || !sameAddress(values.spender, order.info.reactor)
    || bigintValue(values.nonce) !== order.info.nonce
    || bigintValue(values.deadline) !== order.info.deadline
    || !isObject(values.witness)
  ) fail("The Permit2 authorization economics changed.");

  let witnessHash: Hex;
  try {
    witnessHash = hashStruct({
      primaryType: "V3DutchOrder",
      types: V3_DUTCH_ORDER_TYPES,
      data: values.witness as never
    });
  } catch {
    return fail("The Permit2 witness could not be decoded.");
  }
  if (witnessHash !== unsignedOrderHash) fail("The Permit2 witness does not match the encoded order.");
  return canonicalPermitData(order);
}

type DecodedOrder = ReturnType<typeof decodeOrder>;

function decodeOrder(encodedOrder: Hex) {
  try {
    const [order] = decodeAbiParameters(V3_DUTCH_ORDER_ABI, encodedOrder);
    const canonical = encodeAbiParameters(V3_DUTCH_ORDER_ABI, [order]);
    if (canonical.toLowerCase() !== encodedOrder.toLowerCase()) fail("The order serialization is not canonical.");
    return order;
  } catch (cause) {
    if (cause instanceof UniswapXV3OrderVerificationError) throw cause;
    return fail("The encoded order could not be decoded as Dutch V3.");
  }
}

export type VerifiedUniswapXV3Order = {
  orderHash: Hex;
  cosigner: Address;
  nonce: bigint;
  deadline: bigint;
  permit2: Address;
  reactor: Address;
  additionalValidationContract: Address;
  additionalValidationData: Hex;
  permitData: ReturnType<typeof canonicalPermitData>;
  permitPayloadHash: Hex;
};

export async function verifyUniswapXV3Order(input: {
  encodedOrder: unknown;
  request: VNextProviderQuoteRequest;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  orderId: unknown;
  permitData: unknown;
  nowSeconds?: number;
}): Promise<VerifiedUniswapXV3Order> {
  if (input.request.chainId !== 4_663) fail("The order is not on Robinhood Chain.");
  if (
    typeof input.encodedOrder !== "string"
    || !isHex(input.encodedOrder)
    || input.encodedOrder.length < 4
    || (input.encodedOrder.length - 2) / 2 > MAX_ENCODED_ORDER_BYTES
  ) fail("The encoded order is missing or malformed.");

  const encodedOrder = input.encodedOrder as Hex;
  const order = decodeOrder(encodedOrder);
  const nowSeconds = BigInt(input.nowSeconds ?? Math.floor(Date.now() / 1_000));
  const requestedInput = BigInt(input.request.inputAmountAtomic);
  const expectedOutput = BigInt(input.expectedOutputAtomic);
  const protectedOutput = BigInt(input.protectedOutputAtomic);

  if (!sameAddress(order.info.reactor, ROBINHOOD_UNISWAPX_V3_REACTOR)) fail("The order uses an unexpected reactor.");
  if (!sameAddress(order.info.swapper, input.request.recipient)) fail("The order uses an unexpected swapper.");
  if (order.info.deadline <= nowSeconds) fail("The order is expired.");
  if (!sameAddress(order.baseInput.token, input.request.inputAsset)) fail("The order input token changed.");
  if (order.baseInput.startAmount !== requestedInput || order.baseInput.maxAmount !== requestedInput) {
    fail("The order input amount changed.");
  }
  if (order.baseOutputs.length !== 1) fail("The order contains undisclosed outputs.");

  const output = order.baseOutputs[0];
  if (!output) fail("The order has no output.");
  if (!sameAddress(output.token, input.request.outputAsset)) fail("The order output token changed.");
  if (!sameAddress(output.recipient, input.request.recipient)) fail("The order output recipient changed.");
  if (output.startAmount < expectedOutput || output.minAmount !== protectedOutput || output.minAmount > output.startAmount) {
    fail("The encoded output economics do not match the quote.");
  }

  validateCurve(order.baseInput.curve, "The input curve");
  validateCurve(output.curve, "The output curve");
  if (order.cosignerData.outputOverrides.length !== order.baseOutputs.length) {
    fail("The cosigner output overrides do not match the outputs.");
  }
  if (order.cosignerData.inputOverride > order.baseInput.startAmount) fail("The cosigner input override is invalid.");
  const outputOverride = order.cosignerData.outputOverrides[0];
  if (outputOverride === undefined || (outputOverride !== 0n && outputOverride < output.startAmount)) {
    fail("The cosigner output override is invalid.");
  }
  if (order.cosignerData.exclusivityOverrideBps > 10_000n) fail("The exclusivity override is invalid.");
  if (!isAddress(order.cosigner) || !isHex(order.cosignature) || order.cosignature.length !== 132) {
    fail("The cosigner authorization is malformed.");
  }

  const unsignedOrderHash = orderHash(order);
  if (typeof input.orderId !== "string" || !isHex(input.orderId) || input.orderId.length !== 66 || input.orderId.toLowerCase() !== unsignedOrderHash) {
    fail("The order identifier does not match the encoded order.");
  }
  const permitData = verifyPermitData(input.permitData, order, unsignedOrderHash);
  const permitPayloadHash = hashTypedData({
    domain: permitData.domain,
    types: permitData.types,
    primaryType: permitData.primaryType,
    message: permitData.message as never
  });
  let recoveredCosigner: Address;
  try {
    recoveredCosigner = await recoverAddress({
      hash: cosignatureHash(order, unsignedOrderHash),
      signature: order.cosignature
    });
  } catch {
    return fail("The cosigner authorization could not be recovered.");
  }
  if (!sameAddress(recoveredCosigner, order.cosigner)) fail("The cosigner authorization is invalid.");

  return {
    orderHash: unsignedOrderHash,
    cosigner: getAddress(order.cosigner),
    nonce: order.info.nonce,
    deadline: order.info.deadline,
    permit2: ROBINHOOD_UNISWAP_PERMIT2,
    reactor: ROBINHOOD_UNISWAPX_V3_REACTOR,
    additionalValidationContract: getAddress(order.info.additionalValidationContract),
    additionalValidationData: order.info.additionalValidationData,
    permitData,
    permitPayloadHash
  };
}
