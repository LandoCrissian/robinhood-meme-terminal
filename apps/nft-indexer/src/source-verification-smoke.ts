import assert from 'node:assert/strict';
import { zeroAddress, type Address, type Hex } from 'viem';
import { RMT_NFT_ACTIVITY_SOURCES } from '@rmt/shared/nft/activity-sources';
import { verifyReviewedNftSources, type SourceVerificationRpc } from './source-verification.js';

const source = RMT_NFT_ACTIVITY_SOURCES[0]!;
function rpc(overrides: Partial<SourceVerificationRpc> = {}): SourceVerificationRpc {
  return {
    getChainId: async () => 4663,
    getTransactionReceipt: async () => ({
      transactionHash: source.deploymentTransaction,
      blockNumber: source.startBlock,
      status: 'success',
      contractAddress: source.collectionAddress,
      to: null
    }),
    getBytecode: async () => '0x6000',
    readContract: async () => true,
    ...overrides
  };
}

const verified = await verifyReviewedNftSources(rpc(), RMT_NFT_ACTIVITY_SOURCES, () => new Date('2026-08-26T00:00:00Z'));
assert.equal(verified.length, 1);
assert.equal(verified[0]?.projectId, 'ccff00');
await assert.rejects(verifyReviewedNftSources(rpc(), []), /every reviewed/);
await assert.rejects(verifyReviewedNftSources(rpc(), [{ ...source, collectionAddress: zeroAddress }] as never), /reviewed activity-source/);
await assert.rejects(verifyReviewedNftSources(rpc({ getChainId: async () => 1 }), RMT_NFT_ACTIVITY_SOURCES), /Chain 4663/);
await assert.rejects(verifyReviewedNftSources(rpc({ getBytecode: async () => '0x' }), RMT_NFT_ACTIVITY_SOURCES), /no current bytecode/);
await assert.rejects(verifyReviewedNftSources(rpc({ readContract: async () => false }), RMT_NFT_ACTIVITY_SOURCES), /does not support ERC721/);
await assert.rejects(verifyReviewedNftSources(rpc({
  getTransactionReceipt: async () => ({ transactionHash: `0x${'1'.repeat(64)}` as Hex, blockNumber: source.startBlock, status: 'success', contractAddress: source.collectionAddress, to: null })
}), RMT_NFT_ACTIVITY_SOURCES), /transaction mismatch/);
await assert.rejects(verifyReviewedNftSources(rpc({
  getTransactionReceipt: async () => ({ transactionHash: source.deploymentTransaction, blockNumber: source.startBlock + 1n, status: 'success', contractAddress: source.collectionAddress, to: null })
}), RMT_NFT_ACTIVITY_SOURCES), /block mismatch/);
await assert.rejects(verifyReviewedNftSources(rpc({
  getTransactionReceipt: async () => ({ transactionHash: source.deploymentTransaction, blockNumber: source.startBlock, status: 'success', contractAddress: zeroAddress as Address, to: null })
}), RMT_NFT_ACTIVITY_SOURCES), /expected collection/);
await assert.rejects(verifyReviewedNftSources(rpc({
  getTransactionReceipt: async () => ({ transactionHash: source.deploymentTransaction, blockNumber: source.startBlock, status: 'success', contractAddress: source.collectionAddress, to: zeroAddress })
}), RMT_NFT_ACTIVITY_SOURCES), /expected collection/);
console.info('nft-indexer source verification smoke: PASS');
