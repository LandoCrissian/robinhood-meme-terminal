import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { decodeVerifiedRmtNftActivityLog, type RmtNftActivityCollectionContext, type RmtNftRawLog } from '@rmt/shared/nft/activity-domain';

const collection = getAddress('0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146');
const alice = getAddress('0x1111111111111111111111111111111111111111');
const bob = getAddress('0x2222222222222222222222222222222222222222');
const operator = getAddress('0x3333333333333333333333333333333333333333');
const hash = (character: string) => `0x${character.repeat(64)}` as Hex;
const exactTopics = (values: readonly (Hex | readonly Hex[] | null)[]) => values.filter((value): value is Hex => typeof value === 'string');
const context = (standard: 'ERC721' | 'ERC1155'): RmtNftActivityCollectionContext => ({ projectId: 'test', collectionAddress: collection, standard });
const base = (topics: readonly Hex[], data: Hex = '0x'): RmtNftRawLog => ({
  chainId: 4663, address: collection, topics, data, transactionHash: hash('1'), blockHash: hash('2'), blockNumber: 10n, logIndex: 3
});

const transferAbi = [{ type: 'event', name: 'Transfer', anonymous: false, inputs: [
  { indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: true, name: 'tokenId', type: 'uint256' }
]}] as const;
function erc721(from: Address, to: Address, tokenId: bigint) {
  return base(exactTopics(encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from, to, tokenId } })));
}
for (const [from, to, kind] of [[zeroAddress, alice, 'MINT'], [alice, bob, 'TRANSFER'], [bob, zeroAddress, 'BURN']] as const) {
  const result = decodeVerifiedRmtNftActivityLog(erc721(from, to, 2n ** 255n), context('ERC721'));
  assert.equal(result.status, 'DECODED');
  if (result.status === 'DECODED') {
    assert.equal(result.event.movements[0]?.kind, kind);
    assert.equal(result.event.marketMeaning, 'NOT_ESTABLISHED');
  }
}

const singleAbi = [{ type: 'event', name: 'TransferSingle', anonymous: false, inputs: [
  { indexed: true, name: 'operator', type: 'address' }, { indexed: true, name: 'from', type: 'address' },
  { indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'id', type: 'uint256' },
  { indexed: false, name: 'value', type: 'uint256' }
]}] as const;
const single = base(
  exactTopics(encodeEventTopics({ abi: singleAbi, eventName: 'TransferSingle', args: { operator, from: zeroAddress, to: alice } })),
  encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [9n, 12n])
);
assert.equal(decodeVerifiedRmtNftActivityLog(single, context('ERC1155')).status, 'DECODED');

const batchAbi = [{ type: 'event', name: 'TransferBatch', anonymous: false, inputs: [
  { indexed: true, name: 'operator', type: 'address' }, { indexed: true, name: 'from', type: 'address' },
  { indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'ids', type: 'uint256[]' },
  { indexed: false, name: 'values', type: 'uint256[]' }
]}] as const;
const batch = base(
  exactTopics(encodeEventTopics({ abi: batchAbi, eventName: 'TransferBatch', args: { operator, from: alice, to: bob } })),
  encodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], [[1n, 2n], [3n, 4n]])
);
const batchResult = decodeVerifiedRmtNftActivityLog(batch, context('ERC1155'));
assert.equal(batchResult.status, 'DECODED');
if (batchResult.status === 'DECODED') assert.equal(batchResult.event.movements.length, 2);
assert.deepEqual(decodeVerifiedRmtNftActivityLog({ ...single, removed: true }, context('ERC1155')), { status: 'IGNORED', reason: 'REMOVED_LOG' });
assert.deepEqual(decodeVerifiedRmtNftActivityLog({ ...single, transactionHash: null }, context('ERC1155')), { status: 'IGNORED', reason: 'MISSING_LOG_IDENTITY' });
console.info('nft-indexer activity smoke: PASS');
