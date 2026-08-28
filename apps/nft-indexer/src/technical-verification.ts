import {
  getAddress,
  isAddressEqual,
  isHex,
  keccak256,
  type Address,
  type Hex
} from 'viem';
import { RMT_NFT_CHAIN_ID } from '@rmt/shared/nft/project-registry';
import type {
  RmtNftProxyDetection,
  RmtNftTechnicalVerificationClassification,
  RmtNftTokenUriKind
} from '@rmt/shared/nft/technical-verification';

const ERC165_ABI = [{
  type: 'function', name: 'supportsInterface', stateMutability: 'view',
  inputs: [{ name: 'interfaceId', type: 'bytes4' }], outputs: [{ type: 'bool' }]
}] as const;

export type NftTechnicalVerificationCandidate = {
  projectId: string;
  collectionAddress: Address;
  declaredStandard: 'ERC721';
};

export type NftCreationProvenance = {
  deploymentTransaction: Hex;
  startBlock: bigint | null;
  creator: Address;
  proxyDetected: RmtNftProxyDetection;
  implementationAddress: Address | null;
};

export type NftTechnicalVerificationRpc = {
  getChainId(): Promise<number>;
  getTransactionReceipt(input: { hash: Hex }): Promise<{
    transactionHash: Hex;
    blockNumber: bigint;
    status: 'success' | 'reverted';
    contractAddress: Address | null;
    to: Address | null;
  }>;
  getBytecode(input: { address: Address }): Promise<Hex | undefined>;
  readInterface(input: { address: Address; interfaceId: Hex; abi: typeof ERC165_ABI }): Promise<unknown>;
  readIdentity(input: { address: Address; field: 'name' | 'symbol' }): Promise<string | null>;
  inspectRepresentativeToken(input: { address: Address; startBlock: bigint }): Promise<{
    tokenId: bigint;
    tokenUriKind: RmtNftTokenUriKind;
  } | null>;
};

export type NftCreationProvenanceProvider = {
  readCreationProvenance(address: Address): Promise<NftCreationProvenance>;
};

export type NftTechnicalVerificationResult = {
  projectId: string;
  chainId: number;
  collectionAddress: Address;
  standard: 'ERC721';
  classification: RmtNftTechnicalVerificationClassification;
  deploymentTransaction: Hex | null;
  startBlock: bigint | null;
  creator: Address | null;
  runtimeBytecodeHash: Hex | null;
  supportsErc165: boolean | null;
  supportsInvalidInterface: boolean | null;
  supportsErc721: boolean | null;
  supportsErc721Metadata: boolean | null;
  name: string | null;
  symbol: string | null;
  representativeTokenId: bigint | null;
  tokenUriKind: RmtNftTokenUriKind;
  proxyDetected: RmtNftProxyDetection;
  implementationAddress: Address | null;
  implementationRuntimeBytecodeHash: Hex | null;
  verifiedAt: string;
  reason: string | null;
};

export class NftVerificationProviderUnavailableError extends Error {}
export class NftVerificationMalformedProviderResponseError extends Error {}

type InterfaceReadResult =
  | { ok: true; value: boolean }
  | {
    ok: false;
    classification: 'INCONCLUSIVE_PROVIDER_UNAVAILABLE' | 'INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE';
    reason: string;
  };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function baseResult(candidate: NftTechnicalVerificationCandidate, now: () => Date): NftTechnicalVerificationResult {
  return {
    projectId: candidate.projectId,
    chainId: RMT_NFT_CHAIN_ID,
    collectionAddress: getAddress(candidate.collectionAddress),
    standard: 'ERC721',
    classification: 'INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE',
    deploymentTransaction: null,
    startBlock: null,
    creator: null,
    runtimeBytecodeHash: null,
    supportsErc165: null,
    supportsInvalidInterface: null,
    supportsErc721: null,
    supportsErc721Metadata: null,
    name: null,
    symbol: null,
    representativeTokenId: null,
    tokenUriKind: 'UNAVAILABLE',
    proxyDetected: 'UNKNOWN',
    implementationAddress: null,
    implementationRuntimeBytecodeHash: null,
    verifiedAt: now().toISOString(),
    reason: null
  };
}

function classify(
  result: NftTechnicalVerificationResult,
  classification: RmtNftTechnicalVerificationClassification,
  reason: string
) {
  return { ...result, classification, reason };
}

export function minimalProxyImplementation(bytecode: Hex): Address | null {
  const match = /^0x363d3d373d3d3d363d73([0-9a-fA-F]{40})5af43d82803e903d91602b57fd5bf3$/.exec(bytecode);
  return match ? getAddress(`0x${match[1]}`) : null;
}

export async function assertNftTechnicalVerificationChain(rpc: Pick<NftTechnicalVerificationRpc, 'getChainId'>) {
  const chainId = await rpc.getChainId();
  if (chainId !== RMT_NFT_CHAIN_ID) throw new Error(`WRONG_CHAIN: expected 4663, received ${chainId}`);
}

export async function verifyNftTechnicalCandidate(
  candidate: NftTechnicalVerificationCandidate,
  dependencies: { rpc: NftTechnicalVerificationRpc; provenance: NftCreationProvenanceProvider },
  now: () => Date = () => new Date()
): Promise<NftTechnicalVerificationResult> {
  let result = baseResult(candidate, now);
  let provenance: NftCreationProvenance;
  try {
    provenance = await dependencies.provenance.readCreationProvenance(candidate.collectionAddress);
  } catch (error) {
    if (error instanceof NftVerificationProviderUnavailableError) {
      return classify(result, 'INCONCLUSIVE_PROVIDER_UNAVAILABLE', error.message);
    }
    return classify(result, 'INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE',
      error instanceof Error ? error.message : 'Blockscout creation provenance was malformed');
  }

  result = {
    ...result,
    deploymentTransaction: provenance.deploymentTransaction,
    startBlock: provenance.startBlock,
    creator: provenance.creator,
    proxyDetected: provenance.proxyDetected,
    implementationAddress: provenance.implementationAddress
  };

  let receipt: Awaited<ReturnType<NftTechnicalVerificationRpc['getTransactionReceipt']>>;
  try {
    receipt = await dependencies.rpc.getTransactionReceipt({ hash: provenance.deploymentTransaction });
  } catch (error) {
    return classify(
      result,
      'INCONCLUSIVE_PROVIDER_UNAVAILABLE',
      `Creation receipt provider unavailable: ${errorMessage(error, 'unknown provider error')}`
    );
  }
  result = { ...result, startBlock: receipt.blockNumber };
  if (receipt.transactionHash.toLowerCase() !== provenance.deploymentTransaction.toLowerCase() || receipt.status !== 'success') {
    return classify(result, 'CREATION_PROVENANCE_MISMATCH', 'Creation transaction hash or success status mismatched');
  }
  if (provenance.startBlock !== null && receipt.blockNumber !== provenance.startBlock) {
    return classify(result, 'CREATION_PROVENANCE_MISMATCH', 'Creation block mismatched Blockscout provenance');
  }
  const factoryCreation = receipt.to !== null;
  if (!factoryCreation && (receipt.contractAddress === null || !isAddressEqual(receipt.contractAddress, candidate.collectionAddress))) {
    return classify(result, 'CREATION_PROVENANCE_MISMATCH', 'Top-level receipt contract address mismatched candidate collection');
  }

  let bytecode: Hex | undefined;
  try {
    bytecode = await dependencies.rpc.getBytecode({ address: candidate.collectionAddress });
  } catch (error) {
    if (!factoryCreation) {
      return classify(
        result,
        'INCONCLUSIVE_PROVIDER_UNAVAILABLE',
        `Collection bytecode provider unavailable: ${errorMessage(error, 'unknown provider error')}`
      );
    }
  }
  if ((!bytecode || bytecode === '0x') && !factoryCreation) {
    return classify(result, 'NO_CURRENT_BYTECODE', 'Collection has no current runtime bytecode');
  }
  if (bytecode && bytecode !== '0x' && !isHex(bytecode) && !factoryCreation) {
    return classify(result, 'INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE', 'Collection bytecode response was malformed');
  }
  if (bytecode && bytecode !== '0x' && isHex(bytecode)) {
    const minimalProxy = minimalProxyImplementation(bytecode);
    if (minimalProxy !== null) {
      result = { ...result, proxyDetected: 'YES', implementationAddress: minimalProxy };
    }
    result = { ...result, runtimeBytecodeHash: keccak256(bytecode) };
  }

  if (result.implementationAddress !== null) {
    let implementationCode: Hex | undefined;
    try {
      implementationCode = await dependencies.rpc.getBytecode({ address: result.implementationAddress });
    } catch {
      implementationCode = undefined;
    }
    result = {
      ...result,
      implementationRuntimeBytecodeHash: implementationCode && implementationCode !== '0x' && isHex(implementationCode)
        ? keccak256(implementationCode)
        : null
    };
  }

  const readInterface = (interfaceId: Hex) => dependencies.rpc.readInterface({
    address: candidate.collectionAddress,
    interfaceId,
    abi: ERC165_ABI
  });
  const readRequiredInterface = async (interfaceId: Hex, label: string): Promise<InterfaceReadResult> => {
    let value: unknown;
    try {
      value = await readInterface(interfaceId);
    } catch (error) {
      if (error instanceof NftVerificationMalformedProviderResponseError) {
        return { ok: false, classification: 'INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE', reason: `${label} response malformed: ${error.message}` };
      }
      return {
        ok: false,
        classification: 'INCONCLUSIVE_PROVIDER_UNAVAILABLE',
        reason: `${label} provider unavailable: ${errorMessage(error, 'unknown provider error')}`
      };
    }
    if (typeof value !== 'boolean') {
      return { ok: false, classification: 'INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE', reason: `${label} response was not boolean` };
    }
    return { ok: true, value };
  };

  const erc165Read = await readRequiredInterface('0x01ffc9a7', 'ERC165 supportsInterface');
  if (!erc165Read.ok && !factoryCreation) return classify(result, erc165Read.classification, erc165Read.reason);
  const supportsErc165 = erc165Read.ok ? erc165Read.value : null;
  result = { ...result, supportsErc165 };

  const invalidInterfaceRead = await readRequiredInterface('0xffffffff', 'Invalid-interface supportsInterface');
  if (!invalidInterfaceRead.ok && !factoryCreation) {
    return classify(result, invalidInterfaceRead.classification, invalidInterfaceRead.reason);
  }
  const supportsInvalidInterface = invalidInterfaceRead.ok ? invalidInterfaceRead.value : null;
  result = { ...result, supportsInvalidInterface };

  const erc721Read = await readRequiredInterface('0x80ac58cd', 'ERC721 supportsInterface');
  if (!erc721Read.ok && !factoryCreation) return classify(result, erc721Read.classification, erc721Read.reason);
  const supportsErc721 = erc721Read.ok ? erc721Read.value : null;
  result = { ...result, supportsErc721 };

  let supportsErc721Metadata: boolean | null = null;
  try {
    const metadataRead = await readInterface('0x5b5e139f');
    supportsErc721Metadata = typeof metadataRead === 'boolean' ? metadataRead : null;
  } catch {
    supportsErc721Metadata = null;
  }
  const [name, symbol, representative] = await Promise.all([
    dependencies.rpc.readIdentity({ address: candidate.collectionAddress, field: 'name' }).catch(() => null),
    dependencies.rpc.readIdentity({ address: candidate.collectionAddress, field: 'symbol' }).catch(() => null),
    supportsErc721Metadata === true
      ? dependencies.rpc.inspectRepresentativeToken({ address: candidate.collectionAddress, startBlock: receipt.blockNumber }).catch(() => null)
      : Promise.resolve(null)
  ]);
  result = {
    ...result,
    supportsErc721Metadata,
    name,
    symbol,
    representativeTokenId: representative?.tokenId ?? null,
    tokenUriKind: representative?.tokenUriKind ?? 'UNAVAILABLE'
  };
  if (factoryCreation) {
    return classify(result, 'UNSUPPORTED_FACTORY_CREATION_V1', 'Creation transaction targets a factory or existing contract');
  }
  if (supportsErc165 !== true) return classify(result, 'ERC165_UNSUPPORTED', 'ERC165 interface is not supported');
  if (supportsInvalidInterface !== false) {
    return classify(result, 'INVALID_INTERFACE_BEHAVIOR', 'Invalid ERC165 interface id did not return false');
  }
  if (supportsErc721 !== true) return classify(result, 'ERC721_UNSUPPORTED', 'ERC721 interface is not supported');
  return { ...result, classification: 'VERIFIED_TOP_LEVEL_CREATION', reason: null };
}

export async function verifyNftTechnicalBatch(
  candidates: readonly NftTechnicalVerificationCandidate[],
  dependencies: { rpc: NftTechnicalVerificationRpc; provenance: NftCreationProvenanceProvider },
  now: () => Date = () => new Date()
) {
  await assertNftTechnicalVerificationChain(dependencies.rpc);
  const results: NftTechnicalVerificationResult[] = [];
  for (let index = 0; index < candidates.length; index += 2) {
    results.push(...await Promise.all(candidates.slice(index, index + 2).map((candidate) =>
      verifyNftTechnicalCandidate(candidate, dependencies, now)
    )));
  }
  return results;
}
