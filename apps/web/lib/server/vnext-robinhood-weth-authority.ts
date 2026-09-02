import { getAddress, keccak256, type Address, type Hex } from "viem";
import { ROBINHOOD_WETH } from "../uniswap-v4";

export const ROBINHOOD_WETH_RUNTIME_HASH = "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353" as Hex;
export const ROBINHOOD_WETH_IMPLEMENTATION = getAddress("0xC6B81b429797E0f555440b70cD99e032D7AE947e");
export const ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH = "0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650" as Hex;
export const ROBINHOOD_WETH_EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

export type VNextRobinhoodWethAuthorityClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<{ number: bigint; hash: Hex | null }>;
  getBytecode(input: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  getStorageAt(input: { address: Address; slot: Hex; blockNumber: bigint }): Promise<Hex | undefined>;
};

export type VNextRobinhoodWethAuthority = {
  chainId: 4_663;
  weth: Address;
  wethProxyRuntimeHash: Hex;
  wethImplementation: Address;
  wethImplementationRuntimeHash: Hex;
  verifiedAtBlock: string;
  verifiedAtBlockHash: Hex;
};

export type VNextRobinhoodWethAuthorityEvidence = {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex | null;
  recheckedBlockNumber: bigint;
  recheckedBlockHash: Hex | null;
  wethProxyRuntimeHash: Hex | null;
  implementationSlot: Hex | undefined;
  implementationCodePresent: boolean;
  wethImplementationRuntimeHash: Hex | null;
};

function requireIdentity(actual: string, expected: string, label: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} changed (expected ${expected}, received ${actual}).`);
  }
}

function runtimeHash(code: Hex | undefined, label: string) {
  if (!code || code === "0x") throw new Error(`${label} has no runtime bytecode.`);
  return keccak256(code).toLowerCase() as Hex;
}

export function assertCanonicalWethImplementationSlot(implementationSlot: Hex | undefined) {
  if (!implementationSlot || !BYTES32.test(implementationSlot)) {
    throw new Error("Canonical WETH proxy implementation slot is malformed.");
  }
  if (implementationSlot.toLowerCase() === ZERO_BYTES32) {
    throw new Error("Canonical WETH proxy implementation is unavailable.");
  }
  if (implementationSlot.slice(2, 26) !== "0".repeat(24)) {
    throw new Error("Canonical WETH proxy implementation slot is malformed.");
  }
  const implementation = getAddress(`0x${implementationSlot.slice(-40)}`);
  requireIdentity(implementation, ROBINHOOD_WETH_IMPLEMENTATION, "canonical WETH implementation address");
  return implementation;
}

export async function assertVNextRobinhoodBlockContext(
  client: Pick<VNextRobinhoodWethAuthorityClient, "getBlock">,
  blockNumber: bigint,
  expectedBlockHash: Hex
) {
  const block = await client.getBlock({ blockNumber });
  if (block.number !== blockNumber || !block.hash || block.hash.toLowerCase() !== expectedBlockHash.toLowerCase()) {
    throw new Error("Canonical Robinhood Chain verification block changed.");
  }
  return block;
}

export function assertCanonicalRobinhoodWethAuthorityEvidence(
  evidence: VNextRobinhoodWethAuthorityEvidence
): VNextRobinhoodWethAuthority {
  if (evidence.chainId !== 4_663) {
    throw new Error(`Canonical WETH authority requires Robinhood Chain 4663 (received ${evidence.chainId}).`);
  }
  if (evidence.blockNumber <= 0n || !evidence.blockHash || !BYTES32.test(evidence.blockHash)) {
    throw new Error("Canonical Robinhood Chain verification block hash is unavailable.");
  }
  if (
    evidence.recheckedBlockNumber !== evidence.blockNumber
    || !evidence.recheckedBlockHash
    || !BYTES32.test(evidence.recheckedBlockHash)
    || evidence.recheckedBlockHash.toLowerCase() !== evidence.blockHash.toLowerCase()
  ) {
    throw new Error("Canonical Robinhood Chain verification block changed.");
  }
  if (!evidence.wethProxyRuntimeHash) throw new Error("canonical WETH proxy has no runtime bytecode.");
  requireIdentity(evidence.wethProxyRuntimeHash, ROBINHOOD_WETH_RUNTIME_HASH, "canonical WETH proxy runtime");
  const wethImplementation = assertCanonicalWethImplementationSlot(evidence.implementationSlot);
  if (!evidence.implementationCodePresent || !evidence.wethImplementationRuntimeHash) {
    throw new Error("canonical WETH implementation has no runtime bytecode.");
  }
  requireIdentity(
    evidence.wethImplementationRuntimeHash,
    ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH,
    "canonical WETH implementation runtime"
  );
  return {
    chainId: 4_663,
    weth: ROBINHOOD_WETH,
    wethProxyRuntimeHash: ROBINHOOD_WETH_RUNTIME_HASH,
    wethImplementation,
    wethImplementationRuntimeHash: ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH,
    verifiedAtBlock: evidence.blockNumber.toString(),
    verifiedAtBlockHash: evidence.blockHash
  };
}

/**
 * Server-only pre-sign authority for the canonical Robinhood WETH proxy.
 * Every bytecode and storage read is pinned to one canonical block, whose
 * hash is re-read after verification so mixed or reorged evidence fails closed.
 */
export async function verifyCanonicalRobinhoodWethAuthority(
  client: VNextRobinhoodWethAuthorityClient,
  expectedBlock?: { blockNumber: bigint; blockHash: Hex }
): Promise<VNextRobinhoodWethAuthority> {
  const [chainId, blockNumber] = await Promise.all([
    client.getChainId(),
    expectedBlock ? Promise.resolve(expectedBlock.blockNumber) : client.getBlockNumber()
  ]);
  if (chainId !== 4_663) {
    throw new Error(`Canonical WETH authority requires Robinhood Chain 4663 (received ${chainId}).`);
  }
  const block = await client.getBlock({ blockNumber });
  if (block.number !== blockNumber || !block.hash) {
    throw new Error("Canonical Robinhood Chain verification block hash is unavailable.");
  }
  if (expectedBlock && block.hash.toLowerCase() !== expectedBlock.blockHash.toLowerCase()) {
    throw new Error("Canonical Robinhood Chain verification block changed.");
  }

  const [wethCode, implementationSlot] = await Promise.all([
    client.getBytecode({ address: ROBINHOOD_WETH, blockNumber }),
    client.getStorageAt({
      address: ROBINHOOD_WETH,
      slot: ROBINHOOD_WETH_EIP1967_IMPLEMENTATION_SLOT,
      blockNumber
    })
  ]);
  // The proxy exposes no trustworthy non-admin implementation getter. The
  // EIP-1967 storage read is therefore the authoritative proxy-to-code link.
  const wethImplementation = assertCanonicalWethImplementationSlot(implementationSlot);
  const implementationCode = await client.getBytecode({ address: wethImplementation, blockNumber });
  const recheckedBlock = await client.getBlock({ blockNumber });
  return assertCanonicalRobinhoodWethAuthorityEvidence({
    chainId,
    blockNumber,
    blockHash: block.hash,
    recheckedBlockNumber: recheckedBlock.number,
    recheckedBlockHash: recheckedBlock.hash,
    wethProxyRuntimeHash: wethCode && wethCode !== "0x" ? runtimeHash(wethCode, "canonical WETH proxy") : null,
    implementationSlot,
    implementationCodePresent: Boolean(implementationCode && implementationCode !== "0x"),
    wethImplementationRuntimeHash: implementationCode && implementationCode !== "0x"
      ? runtimeHash(implementationCode, "canonical WETH implementation")
      : null
  });
}
