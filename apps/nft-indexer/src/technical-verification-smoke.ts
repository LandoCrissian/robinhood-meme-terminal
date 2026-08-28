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
await classify('INCONCLUSIVE_PROVIDER_UNAVAILABLE', { getTransactionReceipt: async () => { throw new Error('receipt timeout'); } });
await classify('INCONCLUSIVE_PROVIDER_UNAVAILABLE', { getBytecode: async () => { throw new Error('bytecode timeout'); } });
await classify('NO_CURRENT_BYTECODE', { getBytecode: async () => '0x' });
for (const failedInterface of ['0x01ffc9a7', '0xffffffff', '0x80ac58cd'] as const) {
  await classify('INCONCLUSIVE_PROVIDER_UNAVAILABLE', {
    readInterface: async ({ interfaceId }) => {
      if (interfaceId === failedInterface) throw new Error(`${failedInterface} timeout`);
      return interfaceId !== '0xffffffff';
    }
  });
  await classify('INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE', {
    readInterface: async ({ interfaceId }) => interfaceId === failedInterface ? 'true' : interfaceId !== '0xffffffff'
  });
}
await classify('ERC165_UNSUPPORTED', { readInterface: async ({ interfaceId }) => interfaceId === '0xffffffff' ? false : interfaceId !== '0x01ffc9a7' });
await classify('INVALID_INTERFACE_BEHAVIOR', { readInterface: async () => true });
await classify('ERC721_UNSUPPORTED', { readInterface: async ({ interfaceId }) => interfaceId !== '0xffffffff' && interfaceId !== '0x80ac58cd' });

const metadataOptional = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc({ readInterface: async ({ interfaceId }) => interfaceId !== '0xffffffff' && interfaceId !== '0x5b5e139f' }),
  provenance: provenance()
});
assert.equal(metadataOptional.classification, 'VERIFIED_TOP_LEVEL_CREATION');
assert.equal(metadataOptional.supportsErc721Metadata, false);

const metadataProviderFailure = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc({
    readInterface: async ({ interfaceId }) => {
      if (interfaceId === '0x5b5e139f') throw new Error('optional metadata timeout');
      return interfaceId !== '0xffffffff';
    }
  }),
  provenance: provenance()
});
assert.equal(metadataProviderFailure.classification, 'VERIFIED_TOP_LEVEL_CREATION');
assert.equal(metadataProviderFailure.supportsErc721Metadata, null);

const identityProviderFailure = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc({ readIdentity: async () => { throw new Error('optional identity timeout'); } }),
  provenance: provenance()
});
assert.equal(identityProviderFailure.classification, 'VERIFIED_TOP_LEVEL_CREATION');
assert.equal(identityProviderFailure.name, null);
assert.equal(identityProviderFailure.symbol, null);

const representativeProviderFailure = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc({ inspectRepresentativeToken: async () => { throw new Error('optional token inspection timeout'); } }),
  provenance: provenance()
});
assert.equal(representativeProviderFailure.classification, 'VERIFIED_TOP_LEVEL_CREATION');
assert.equal(representativeProviderFailure.representativeTokenId, null);
assert.equal(representativeProviderFailure.tokenUriKind, 'UNAVAILABLE');

const implementation = '09a26fc8fcef18192e267d7a6da9dfb4be81dd6a';
const minimalProxyCode = `0x363d3d373d3d3d363d73${implementation}5af43d82803e903d91602b57fd5bf3` as Hex;
const factoryResult = (rpcOverrides: Partial<NftTechnicalVerificationRpc> = {}) => verifyNftTechnicalCandidate(candidate, {
  rpc: rpc({
    getTransactionReceipt: async () => ({
      transactionHash: deploymentTransaction,
      blockNumber: 100n,
      status: 'success',
      contractAddress: null,
      to: zeroAddress
    }),
    ...rpcOverrides
  }),
  provenance: provenance()
});

const factoryBytecodeTimeout = await factoryResult({ getBytecode: async () => { throw new Error('factory bytecode timeout'); } });
assert.equal(factoryBytecodeTimeout.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryBytecodeTimeout.runtimeBytecodeHash, null);

const factoryZeroBytecode = await factoryResult({ getBytecode: async () => '0x' });
assert.equal(factoryZeroBytecode.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryZeroBytecode.runtimeBytecodeHash, null);

const factoryErc165Timeout = await factoryResult({
  readInterface: async ({ interfaceId }) => {
    if (interfaceId === '0x01ffc9a7') throw new Error('factory ERC165 timeout');
    return interfaceId !== '0xffffffff';
  }
});
assert.equal(factoryErc165Timeout.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryErc165Timeout.supportsErc165, null);
assert.equal(factoryErc165Timeout.supportsErc721, true, 'later successful factory diagnostics must be retained');

const factoryMalformedErc165 = await factoryResult({
  readInterface: async ({ interfaceId }) => interfaceId === '0x01ffc9a7' ? 'true' : interfaceId !== '0xffffffff'
});
assert.equal(factoryMalformedErc165.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryMalformedErc165.supportsErc165, null);

const factoryErc721False = await factoryResult({
  readInterface: async ({ interfaceId }) => interfaceId !== '0xffffffff' && interfaceId !== '0x80ac58cd'
});
assert.equal(factoryErc721False.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryErc721False.supportsErc165, true);
assert.equal(factoryErc721False.supportsInvalidInterface, false);
assert.equal(factoryErc721False.supportsErc721, false);

const factoryMetadataTimeout = await factoryResult({
  readInterface: async ({ interfaceId }) => {
    if (interfaceId === '0x5b5e139f') throw new Error('factory metadata timeout');
    return interfaceId !== '0xffffffff';
  }
});
assert.equal(factoryMetadataTimeout.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryMetadataTimeout.supportsErc721Metadata, null);

const factoryIdentityTimeout = await factoryResult({
  readIdentity: async () => { throw new Error('factory identity timeout'); }
});
assert.equal(factoryIdentityTimeout.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryIdentityTimeout.name, null);
assert.equal(factoryIdentityTimeout.symbol, null);

const factoryImplementationTimeout = await factoryResult({
  getBytecode: async ({ address }) => {
    if (address.toLowerCase() !== collection.toLowerCase()) throw new Error('factory implementation timeout');
    return minimalProxyCode;
  }
});
assert.equal(factoryImplementationTimeout.classification, 'UNSUPPORTED_FACTORY_CREATION_V1');
assert.equal(factoryImplementationTimeout.runtimeBytecodeHash, keccak256(minimalProxyCode));
assert.equal(factoryImplementationTimeout.proxyDetected, 'YES');
assert.equal(factoryImplementationTimeout.implementationRuntimeBytecodeHash, null);
assert.equal(factoryImplementationTimeout.supportsErc165, true);
assert.equal(factoryImplementationTimeout.supportsInvalidInterface, false);
assert.equal(factoryImplementationTimeout.supportsErc721, true);
assert.equal(factoryImplementationTimeout.supportsErc721Metadata, true);
assert.equal(factoryImplementationTimeout.name, 'CCFF00');
assert.equal(factoryImplementationTimeout.symbol, 'CCFF00');
assert.equal(factoryImplementationTimeout.representativeTokenId, 7n);
assert.equal(factoryImplementationTimeout.tokenUriKind, 'DATA_JSON');

const implementationHashProviderFailure = await verifyNftTechnicalCandidate(candidate, {
  rpc: rpc({
    getBytecode: async ({ address }) => {
      if (address.toLowerCase() !== collection.toLowerCase()) throw new Error('optional implementation timeout');
      return minimalProxyCode;
    }
  }),
  provenance: provenance()
});
assert.equal(implementationHashProviderFailure.classification, 'VERIFIED_TOP_LEVEL_CREATION');
assert.equal(implementationHashProviderFailure.implementationRuntimeBytecodeHash, null);

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

const pairedCollection = '0xb87522E093858d992B7555077FF3541597deB34E' as Address;
const pairedTransaction = `0x${'2'.repeat(64)}` as Hex;
const pairResults = await verifyNftTechnicalBatch([
  candidate,
  { projectId: 'paired-candidate', collectionAddress: pairedCollection, declaredStandard: 'ERC721' }
], {
  provenance: {
    readCreationProvenance: async (address) => ({
      deploymentTransaction: address.toLowerCase() === collection.toLowerCase() ? deploymentTransaction : pairedTransaction,
      startBlock: 100n,
      creator: zeroAddress,
      proxyDetected: 'NO',
      implementationAddress: null
    })
  },
  rpc: rpc({
    getTransactionReceipt: async ({ hash }) => {
      if (hash === deploymentTransaction) throw new Error('isolated candidate timeout');
      return {
        transactionHash: pairedTransaction,
        blockNumber: 100n,
        status: 'success',
        contractAddress: pairedCollection,
        to: null
      };
    }
  })
});
assert.equal(pairResults[0]?.classification, 'INCONCLUSIVE_PROVIDER_UNAVAILABLE');
assert.equal(pairResults[1]?.classification, 'VERIFIED_TOP_LEVEL_CREATION');

assert.equal(minimalProxyImplementation(minimalProxyCode)?.toLowerCase(), getAddressForTest(implementation));
assert.equal(minimalProxyImplementation('0x6000'), null);

function getAddressForTest(value: string) {
  return `0x${value}` as Address;
}

console.info('nft-indexer technical verification classification smoke: PASS');
