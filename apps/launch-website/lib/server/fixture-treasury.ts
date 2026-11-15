import { getAddress, keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { sameHex, type fixtureRpc } from "./curve-fixture";

// The SafeL2 v1.4.1 profile is limited to the verified proxy and canonical dependencies.
const singleton = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
const singletonHash = "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff";
const proxyHash = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
const defaultHandler = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const defaultHandlerHash = "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9";
const guardSlot = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const handlerSlot = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";
const ownerCountSlot = "0x3";
const sentinel = "0x0000000000000000000000000000000000000001";
const safeAbi = parseAbi([
  "function masterCopy() view returns (address)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)",
]);

type FixtureReader = Pick<ReturnType<typeof fixtureRpc>, "getCode" | "getStorageAt" | "readContract">;
const codeMatches = (code: Hex | undefined, expected: string) => !!code && code !== "0x" && keccak256(code) === expected;
const emptyWord = /^0x0{64}$/i;

export async function classifyFixtureTreasury(rpc: FixtureReader, address: Address, blockNumber: bigint) {
  // Low addresses include precompiles, system addresses and common sinks whose bytecode can be empty.
  if (BigInt(address) <= 0xffffn) return null;
  const target = { address, blockNumber } as const;
  const code = await rpc.getCode(target);
  if (code === undefined || code === "0x") return "no-code";
  if (!codeMatches(code, proxyHash)) return null;

  const read = { ...target, abi: safeAbi } as const;
  const [master, guard, fallback, count] = await Promise.all([
    rpc.readContract({ ...read, functionName: "masterCopy" }),
    rpc.getStorageAt({ ...target, slot: guardSlot }),
    rpc.getStorageAt({ ...target, slot: handlerSlot }),
    rpc.getStorageAt({ ...target, slot: ownerCountSlot }),
  ]);
  if (!sameHex(master, singleton) || !guard || !emptyWord.test(guard)
      || !fallback || !/^0x0{24}[0-9a-f]{40}$/i.test(fallback)
      || !count || !/^0x[0-9a-f]{64}$/i.test(count)) return null;
  const ownerCount = BigInt(count);
  // Bound the owner response before requesting the dynamic ABI array.
  if (ownerCount < 1n || ownerCount > 64n) return null;
  const handler = getAddress("0x" + fallback.slice(-40).toLowerCase());
  if (handler !== zeroAddress && !sameHex(handler, defaultHandler)) return null;

  const [masterCode, handlerCode, owners, threshold, [modules, nextModule]] = await Promise.all([
    rpc.getCode({ address: singleton, blockNumber }),
    handler === zeroAddress ? undefined : rpc.getCode({ address: handler, blockNumber }),
    rpc.readContract({ ...read, functionName: "getOwners" }),
    rpc.readContract({ ...read, functionName: "getThreshold" }),
    rpc.readContract({ ...read, functionName: "getModulesPaginated", args: [sentinel, 1n] }),
  ]);
  if (!codeMatches(masterCode, singletonHash) || (handler !== zeroAddress && !codeMatches(handlerCode, defaultHandlerHash))
      || owners.length !== Number(ownerCount) || new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length
      || owners.some((owner) => owner === zeroAddress || sameHex(owner, sentinel) || sameHex(owner, address))
      || threshold < 1n || threshold > ownerCount || modules.length || !sameHex(nextModule, sentinel)) return null;
  return "safe-1.4.1";
}
