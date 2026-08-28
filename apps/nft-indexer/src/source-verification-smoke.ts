import assert from 'node:assert/strict';
import { keccak256, zeroAddress, type Address, type Hex } from 'viem';
import { RMT_NFT_ACTIVITY_SOURCES } from '@rmt/shared/nft/activity-sources';
import { verifyReviewedNftSource, verifyReviewedNftSources, type SourceVerificationRpc } from './source-verification.js';
import { assertExactReviewedSourceSet } from './sources.js';

const reviewedSource = RMT_NFT_ACTIVITY_SOURCES[0]!;
const testBytecode = '0x6000' as Hex;
const source = { ...reviewedSource, runtimeBytecodeHash: keccak256(testBytecode) };
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
    getBytecode: async () => testBytecode,
    readContract: async ({ args }) => args[0] !== '0xffffffff',
    ...overrides
  };
}

const verified = await verifyReviewedNftSource(rpc(), source, () => new Date('2026-08-28T00:00:00Z'));
assert.equal(verified.projectId, 'ccff00');
await assert.rejects(verifyReviewedNftSources(rpc(), []), /omits a reviewed/);
await assert.rejects(verifyReviewedNftSources(rpc(), [{ ...reviewedSource, collectionAddress: zeroAddress }] as never), /reviewed activity-source/);
await assert.rejects(verifyReviewedNftSources(rpc({ getChainId: async () => 1 }), RMT_NFT_ACTIVITY_SOURCES), /Chain 4663/);
await assert.rejects(verifyReviewedNftSource(rpc({ getBytecode: async () => '0x' }), source), /no current bytecode/);
await assert.rejects(verifyReviewedNftSource(rpc({ getBytecode: async () => '0x6001' }), source), /bytecode hash/);
await assert.rejects(verifyReviewedNftSource(rpc({ readContract: async ({ args }) => args[0] === '0xffffffff' ? false : args[0] !== '0x01ffc9a7' }), source), /does not support ERC165/);
await assert.rejects(verifyReviewedNftSource(rpc({ readContract: async () => true }), source), /invalid ERC165/);
await assert.rejects(verifyReviewedNftSource(rpc({ readContract: async ({ args }) => args[0] !== '0xffffffff' && args[0] !== '0x80ac58cd' }), source), /does not support ERC721/);
await assert.rejects(verifyReviewedNftSource(rpc({
  getTransactionReceipt: async () => ({ transactionHash: `0x${'1'.repeat(64)}` as Hex, blockNumber: source.startBlock, status: 'success', contractAddress: source.collectionAddress, to: null })
}), source), /transaction mismatch/);
await assert.rejects(verifyReviewedNftSource(rpc({
  getTransactionReceipt: async () => ({ transactionHash: source.deploymentTransaction, blockNumber: source.startBlock + 1n, status: 'success', contractAddress: source.collectionAddress, to: null })
}), source), /block mismatch/);
await assert.rejects(verifyReviewedNftSource(rpc({
  getTransactionReceipt: async () => ({ transactionHash: source.deploymentTransaction, blockNumber: source.startBlock, status: 'success', contractAddress: zeroAddress as Address, to: null })
}), source), /expected collection/);
await assert.rejects(verifyReviewedNftSource(rpc({
  getTransactionReceipt: async () => ({ transactionHash: source.deploymentTransaction, blockNumber: source.startBlock, status: 'success', contractAddress: source.collectionAddress, to: zeroAddress })
}), source), /expected collection/);

const syntheticA = reviewedSource;
const syntheticB = { ...reviewedSource, projectId: 'synthetic-b', collectionAddress: '0x1111111111111111111111111111111111111111' as Address, deploymentTransaction: `0x${'2'.repeat(64)}` as Hex, startBlock: reviewedSource.startBlock + 1n };
const syntheticC = { ...reviewedSource, projectId: 'synthetic-c', collectionAddress: '0x2222222222222222222222222222222222222222' as Address, deploymentTransaction: `0x${'3'.repeat(64)}` as Hex, startBlock: reviewedSource.startBlock + 2n };
assert.doesNotThrow(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA, syntheticB]));
assert.doesNotThrow(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticB, syntheticA]));
assert.throws(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA, syntheticA]), /duplicate source key/);
assert.throws(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA]), /omits a reviewed/);
assert.throws(() => assertExactReviewedSourceSet([syntheticA, syntheticB], [syntheticA, syntheticC]), /not in the reviewed/);
assert.throws(() => assertExactReviewedSourceSet([syntheticA], [{ ...syntheticA, runtimeBytecodeHash: `0x${'f'.repeat(64)}` as Hex }]), /not in the reviewed/);
console.info('nft-indexer source verification smoke: PASS');
