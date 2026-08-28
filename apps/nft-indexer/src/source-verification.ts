import { RMT_CURATED_NFT_PROJECTS, RMT_NFT_CHAIN_ID } from '@rmt/shared/nft/project-registry';
import type { RmtNftActivitySource } from '@rmt/shared/nft/activity-sources';
import { getAddress, isAddressEqual, keccak256, type Address, type Hex } from 'viem';
import { assertReviewedSourceSet } from './sources.js';

const ERC165_ABI = [{
  type: 'function', name: 'supportsInterface', stateMutability: 'view',
  inputs: [{ name: 'interfaceId', type: 'bytes4' }], outputs: [{ type: 'bool' }]
}] as const;

export type SourceVerificationRpc = {
  getChainId(): Promise<number>;
  getTransactionReceipt(input: { hash: Hex }): Promise<{
    transactionHash: Hex;
    blockNumber: bigint;
    status: 'success' | 'reverted';
    contractAddress: Address | null;
    to: Address | null;
  }>;
  getBytecode(input: { address: Address }): Promise<Hex | undefined>;
  readContract(input: { address: Address; abi: typeof ERC165_ABI; functionName: 'supportsInterface'; args: readonly [Hex] }): Promise<unknown>;
};

export type VerifiedNftSource = RmtNftActivitySource & { verifiedAt: string };

export async function verifyReviewedNftSource(
  rpc: SourceVerificationRpc,
  source: RmtNftActivitySource,
  now: () => Date = () => new Date()
): Promise<VerifiedNftSource> {
  if (source.chainId !== RMT_NFT_CHAIN_ID) throw new Error('NFT activity source has the wrong chain');
  const project = RMT_CURATED_NFT_PROJECTS.find((candidate) => candidate.projectId === source.projectId);
  if (!project || !project.ownerApproved || project.status === 'REMOVED') {
    throw new Error('NFT activity source project is not owner-approved and admitted');
  }
  const collection = project.collections.find((candidate) => isAddressEqual(candidate.contractAddress, source.collectionAddress));
  if (!collection) throw new Error('NFT activity source collection is not registered for its project');
  if (collection.verificationStatus !== 'VERIFIED') throw new Error('NFT activity source collection is not technically verified');
  if (collection.chainId !== source.chainId || collection.declaredStandard !== source.standard) {
    throw new Error('NFT activity source standard or chain conflicts with the curated collection');
  }

  const receipt = await rpc.getTransactionReceipt({ hash: source.deploymentTransaction });
  if (receipt.transactionHash.toLowerCase() !== source.deploymentTransaction.toLowerCase()) {
    throw new Error('NFT activity source deployment transaction mismatch');
  }
  if (receipt.status !== 'success') throw new Error('NFT activity source deployment reverted');
  if (receipt.blockNumber !== source.startBlock) throw new Error('NFT activity source deployment block mismatch');
  if (receipt.to !== null || receipt.contractAddress === null || !isAddressEqual(receipt.contractAddress, source.collectionAddress)) {
    throw new Error('NFT activity source deployment did not create the expected collection');
  }
  const bytecode = await rpc.getBytecode({ address: source.collectionAddress });
  if (!bytecode || bytecode === '0x') throw new Error('NFT activity source collection has no current bytecode');
  if (keccak256(bytecode) !== source.runtimeBytecodeHash.toLowerCase()) {
    throw new Error('NFT activity source current runtime bytecode hash conflicts with reviewed evidence');
  }
  const supportsErc165 = await rpc.readContract({
    address: source.collectionAddress, abi: ERC165_ABI, functionName: 'supportsInterface', args: ['0x01ffc9a7']
  });
  if (supportsErc165 !== true) throw new Error('NFT activity source does not support ERC165');
  const supportsInvalidInterface = await rpc.readContract({
    address: source.collectionAddress, abi: ERC165_ABI, functionName: 'supportsInterface', args: ['0xffffffff']
  });
  if (supportsInvalidInterface !== false) throw new Error('NFT activity source has invalid ERC165 interface behavior');
  const interfaceId = source.standard === 'ERC721' ? '0x80ac58cd' : '0xd9b67a26';
  const supportsStandard = await rpc.readContract({
    address: source.collectionAddress, abi: ERC165_ABI, functionName: 'supportsInterface', args: [interfaceId]
  });
  if (supportsStandard !== true) throw new Error(`NFT activity source does not support ${source.standard}`);
  return { ...source, collectionAddress: getAddress(source.collectionAddress), verifiedAt: now().toISOString() };
}

export async function verifyReviewedNftSources(
  rpc: SourceVerificationRpc,
  sources: readonly RmtNftActivitySource[],
  now: () => Date = () => new Date()
): Promise<readonly VerifiedNftSource[]> {
  assertReviewedSourceSet(sources);
  if (await rpc.getChainId() !== RMT_NFT_CHAIN_ID) throw new Error('NFT indexer RPC must resolve to Robinhood Chain 4663');
  const verified: VerifiedNftSource[] = [];
  for (const source of sources) verified.push(await verifyReviewedNftSource(rpc, source, now));
  return verified;
}
