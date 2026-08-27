import assert from 'node:assert/strict';
import { zeroAddress, type Address, type Hex } from 'viem';
import { RMT_NFT_ACTIVITY_SOURCES } from '@rmt/shared/nft/activity-sources';
import { verifyReviewedNftSources, type SourceVerificationRpc } from './source-verification.js';
import { assertExactReviewedSourceSet } from './sources.js';

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
await assert.rejects(verifyReviewedNftSources(rpc(), []), /omits a reviewed/);
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

const syntheticA = source;
const syntheticB = {
  ...source,
  projectId: 'synthetic-b',
  collectionAddress: '0x1111111111111111111111111111111111111111' as Address,
  deploymentTransaction: `0x${'2'.repeat(64)}` as Hex,
  startBlock: source.startBlock + 1n
};
const syntheticC = {
  ...source,
  projectId: 'synthetic-c',
  collectionAddress: '0x2222222222222222222222222222222222222222' as Address,
  deploymentTransaction: `0x${'3'.repeat(64)}` as Hex,
  startBlock: source.startBlock + 2n
};
assert.doesNotThrow(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA, syntheticB]));
assert.doesNotThrow(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticB, syntheticA]));
assert.throws(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA, syntheticA]), /duplicate source key/);
assert.throws(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA]), /omits a reviewed/);
assert.throws(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA, syntheticC]), /not in the reviewed/);
console.info('nft-indexer source verification smoke: PASS');
