import assert from 'node:assert/strict';
import { keccak256, zeroAddress, type Address, type Hex } from 'viem';
import { RMT_NFT_VERIFIED_COLLECTIONS } from '@rmt/shared/nft/technical-verification';
import {
  NftVerificationMalformedProviderResponseError,
  NftVerificationProviderUnavailableError,
  minimalProxyImplementation,
  verifyNftTechnicalBatch,
  verifyNftTechnicalCandidate,
  type NftCreationProvenanceProvider,
  type NftTechnicalVerificationRpc
} from './technical-verification.js';

const collection = '0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146' as Address;
const deploymentTransaction = `0x${'1'.repeat(64)}` as Hex;
const candidate = { projectId: 'ccff00', collectionAddress: collection, declaredStandard: 'ERC721' } as const;
assert.deepEqual(RMT_NFT_VERIFIED_COLLECTIONS.map((entry) => entry.projectId), ['ccff00', 'robin-rabbits', 'gogh-punks']);
let provenanceCalls = 0;

function provenance(overrides: Record<string, unknown> = {}): NftCreationProvenanceProvider {
  return {
    readCreationProvenance: async () => {
      provenanceCalls += 1;
      return {
        deploymentTransaction,
        startBlock: 100n,
        creator: zeroAddress,
        proxyDetected: 'NO',
        implementationAddress: null,
        ...overrides
      } as never;
    }
  };
}

function rpc(overrides: Partial<NftTechnicalVerificationRpc> = {}): NftTechnicalVerificationRpc {
  return {
    getChainId: async () => 4663,
    getTransactionReceipt: async () => ({
      transactionHash: deploymentTransaction,
      blockNumber: 100n,
      status: 'success',
      contractAddress: collection,
      to: null
    }),
    getBytecode: async () => '0x6000',
    readInterface: async ({ interfaceId }) => interfaceId !== '0xffffffff',
    readIdentity: async ({ field }) => field === 'name' ? 'CCFF00' : 'CCFF00',
    inspectRepresentativeToken: async () => ({ tokenId: 7n, tokenUriKind: 'DATA_JSON' }),
    ...overrides
  };
}

const verified = await verifyNftTechnicalBatch([candidate], { rpc: rpc(), provenance: provenance() }, () => new Date('2026-08-28T00:00:00Z'));
assert.equal(verified[0]?.classification, 'VERIFIED_TOP_LEVEL_CREATION');
assert.equal(verified[0]?.runtimeBytecodeHash, keccak256('0x6000'));
assert.equal(verified[0]?.supportsErc721Metadata, true);

provenanceCalls = 0;
await assert.rejects(verifyNftTechnicalBatch([candidate], { rpc: rpc({ getChainId: async () => 1 }), provenance: provenance() }), /WRONG_CHAIN/);
assert.equal(provenanceCalls, 0, 'wrong-chain batch must stop before any candidate provider read');

const classify = async (
  expected: string,
  rpcOverrides: Partial<NftTechnicalVerificationRpc> = {},
  provenanceOverrides: Record<string, unknown> = {}
) => {
  const result = await verifyNftTechnicalCandidate(candidate, { rpc: rpc(rpcOverrides), provenance: provenance(provenanceOverrides) });
  assert.equal(result.classification, expected);
};

await classify('CREATION_PROVENANCE_MISMATCH', { getTransactionReceipt: async () => ({ transactionHash: deploymentTransaction, blockNumber: 100n, status: 'reverted', contractAddress: collection, to: null }) });
await classify('CREATION_PROVENANCE_MISMATCH', {}, { startBlock: 99n });
await classify('UNSUPPORTED_FACTORY_CREATION_V1', { getTransactionReceipt: async () => ({ transactionHash: deploymentTransaction, blockNumber: 100n, status: 'success', contractAddress: null, to: zeroAddress }) });
await classify('CREATION_PROVENANCE_MISMATCH', { getTransactionReceipt: async () => ({ transactionHash: deploymentTransaction, blockNumber: 100n, status: 'success', contractAddress: zeroAddress, to: null }) });
await classify('NO_CURRENT_BYTECODE', { getBytecode: async () => '0x' });
await classify('ERC165_UNSUPPORTED', { readInterface: async ({ interfaceId }) => interfaceId === '0xffffffff' ? false : interfaceId !== '0x01ffc9a7' });
await classify('INVALID_INTERFACE_BEHAVIOR', { readInterface: async () => true });
await classify('ERC721_UNSUPPORTED', { readInterface: async ({ interfaceId }) => interfaceId !== '0xffffffff' && interfaceId !== '0x80ac58cd' });

const metadataOptional = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc({ readInterface: async ({ interfaceId }) => interfaceId !== '0xffffffff' && interfaceId !== '0x5b5e139f' }),
  provenance: provenance()
});
assert.equal(metadataOptional.classification, 'VERIFIED_TOP_LEVEL_CREATION');
assert.equal(metadataOptional.supportsErc721Metadata, false);

const unavailable = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc(),
  provenance: { readCreationProvenance: async () => { throw new NftVerificationProviderUnavailableError('timeout'); } }
});
assert.equal(unavailable.classification, 'INCONCLUSIVE_PROVIDER_UNAVAILABLE');
const malformed = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc(),
  provenance: { readCreationProvenance: async () => { throw new NftVerificationMalformedProviderResponseError('malformed'); } }
});
assert.equal(malformed.classification, 'INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE');

const implementation = '09a26fc8fcef18192e267d7a6da9dfb4be81dd6a';
assert.equal(minimalProxyImplementation(`0x363d3d373d3d3d363d73${implementation}5af43d82803e903d91602b57fd5bf3`)?.toLowerCase(), getAddressForTest(implementation));
assert.equal(minimalProxyImplementation('0x6000'), null);

function getAddressForTest(value: string) {
  return `0x${value}` as Address;
}

console.info('nft-indexer technical verification classification smoke: PASS');
