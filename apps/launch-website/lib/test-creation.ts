import { isLaunchAddress } from "./launch-data";
import type { ReviewedLaunchTerms } from "./launch-draft";

export const testCreationPath = "/api/launchpad/test-creation";
export const testCreationChain = "0x7a69";
export const testCreationFeeWei = 400_000_000_000_000n;
export const testCreationSignature = "function create(string name,string symbol,string projectURI,uint8 supplyPreset,address treasury,uint16 treasuryShareBps,bytes32 intentId,uint256 deadline) payable returns (address token,address curve)" as const;

export type TestCreationFields = Omit<ReviewedLaunchTerms, "supply">;
export type TestCreationRequest = {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
  chainId: typeof testCreationChain;
  intentId: `0x${string}`;
  deadline: string;
  blockNumber: `0x${string}`;
  blockHash: `0x${string}`;
};

export type TestCreationVerification = {
  status: "pending" | "confirmed" | "reverted" | "unavailable";
  transactionHash?: `0x${string}`;
  token?: `0x${string}`;
  indexed?: boolean;
};

export function isTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value);
}

export function isTestCreationRequest(value: unknown): value is TestCreationRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<TestCreationRequest>;
  return Object.keys(input).length === 9 && isLaunchAddress(input.from) && !/^0x0{40}$/i.test(input.from)
    && isLaunchAddress(input.to) && !/^0x0{40}$/i.test(input.to)
    && typeof input.data === "string" && input.data.length <= 2058 && /^0x(?:[0-9a-f]{2}){4,}$/i.test(input.data)
    && typeof input.value === "string" && /^0x[0-9a-f]{1,16}$/i.test(input.value) && BigInt(input.value) === testCreationFeeWei
    && input.chainId === testCreationChain && isTransactionHash(input.intentId)
    && typeof input.deadline === "string" && /^[1-9][0-9]{0,19}$/.test(input.deadline)
    && typeof input.blockNumber === "string" && /^0x[1-9a-f][0-9a-f]{0,15}$/i.test(input.blockNumber) && isTransactionHash(input.blockHash);
}

export function sameTestCreationRequest(left: TestCreationRequest, right: TestCreationRequest) {
  return left.from.toLowerCase() === right.from.toLowerCase() && left.to.toLowerCase() === right.to.toLowerCase()
    && left.data.toLowerCase() === right.data.toLowerCase() && BigInt(left.value) === BigInt(right.value)
    && left.chainId === right.chainId && left.intentId.toLowerCase() === right.intentId.toLowerCase()
    && left.deadline === right.deadline && BigInt(left.blockNumber) === BigInt(right.blockNumber)
    && left.blockHash.toLowerCase() === right.blockHash.toLowerCase();
}

export function isLocalTestWallet(location: Pick<Location, "protocol" | "hostname" | "port">) {
  return location.protocol === "http:" && location.hostname === "127.0.0.1" && Boolean(location.port);
}

export async function calldataMatchesTestCreation(request: TestCreationRequest, fields: TestCreationFields) {
  const { encodeFunctionData, parseAbi, isAddress, zeroAddress } = await import("viem");
  const treasury = fields.treasury || zeroAddress;
  if (!isAddress(treasury) || treasury.toLowerCase() === request.from.toLowerCase()) return false;
  const { name, symbol, projectURI, supplyPreset, treasuryShareBps } = fields;
  const encoded = encodeFunctionData({ abi: parseAbi([testCreationSignature]), functionName: "create",
    args: [name, symbol, projectURI, supplyPreset, treasury, treasuryShareBps, request.intentId, BigInt(request.deadline)] });
  return encoded.toLowerCase() === request.data.toLowerCase();
}
