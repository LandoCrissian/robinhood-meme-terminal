import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex
} from 'viem';
import { robinhoodChain } from '@rmt/shared/chains';
import type { RmtNftTokenUriKind } from '@rmt/shared/nft/technical-verification';
import {
  NftVerificationMalformedProviderResponseError,
  NftVerificationProviderUnavailableError,
  verifyNftTechnicalBatch,
  type NftCreationProvenance,
  type NftTechnicalVerificationCandidate,
  type NftTechnicalVerificationRpc
} from './technical-verification.js';

const DEFAULT_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com/';
const DEFAULT_BLOCKSCOUT_URL = 'https://robinhoodchain.blockscout.com/api/v2';
const TIMEOUT_MS = 15_000;
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const READ_ABI = parseAbi([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)'
]);

function candidatesFromArguments(argv: readonly string[]): NftTechnicalVerificationCandidate[] {
  const values = argv.filter((argument) => argument.startsWith('--candidate=')).map((argument) => argument.slice(12));
  if (values.length === 0) throw new Error('At least one explicit --candidate=projectId,collectionAddress input is required.');
  if (values.length > 16) throw new Error('At most 16 explicit verification candidates are allowed.');
  return values.map((value) => {
    const [projectId, address, extra] = value.trim().split(/[\s,]+/);
    if (!projectId || !address || extra) throw new Error(`Malformed candidate input: ${value}`);
    return { projectId, collectionAddress: getAddress(address), declaredStandard: 'ERC721' };
  });
}

function optionalAddress(value: unknown): Address | null {
  if (typeof value !== 'string') return null;
  try { return getAddress(value); } catch { return null; }
}

function transactionHash(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new NftVerificationMalformedProviderResponseError('Blockscout omitted a valid creation transaction hash.');
  }
  return value as Hex;
}

async function boundedJson(url: URL): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new NftVerificationProviderUnavailableError(`Blockscout returned HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 1_000_000) {
      throw new NftVerificationMalformedProviderResponseError('Blockscout response exceeded the bounded size.');
    }
    const text = await response.text();
    if (text.length > 1_000_000) throw new NftVerificationMalformedProviderResponseError('Blockscout response exceeded the bounded size.');
    const decoded: unknown = JSON.parse(text);
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new NftVerificationMalformedProviderResponseError('Blockscout response was not an object.');
    }
    return decoded as Record<string, unknown>;
  } catch (error) {
    if (error instanceof NftVerificationMalformedProviderResponseError || error instanceof NftVerificationProviderUnavailableError) throw error;
    if (error instanceof SyntaxError) throw new NftVerificationMalformedProviderResponseError('Blockscout response was not valid JSON.');
    throw new NftVerificationProviderUnavailableError(error instanceof Error ? error.message : 'Blockscout request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

function tokenUriKind(value: string): RmtNftTokenUriKind {
  if (value.startsWith('data:application/json')) return 'DATA_JSON';
  if (value.startsWith('ipfs://')) return 'IPFS';
  if (value.startsWith('https://')) return 'HTTPS';
  return 'OTHER';
}

async function main() {
  const candidates = candidatesFromArguments(process.argv.slice(2));
  const rpcUrl = process.env.NFT_TECHNICAL_VERIFICATION_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const blockscoutBase = process.env.NFT_TECHNICAL_VERIFICATION_BLOCKSCOUT_URL?.trim() || DEFAULT_BLOCKSCOUT_URL;
  const client = createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl, { timeout: TIMEOUT_MS, retryCount: 1 }) });

  const rpc: NftTechnicalVerificationRpc = {
    getChainId: () => client.getChainId(),
    getTransactionReceipt: async ({ hash }) => {
      const receipt = await client.getTransactionReceipt({ hash });
      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        contractAddress: receipt.contractAddress ?? null,
        to: receipt.to
      };
    },
    getBytecode: ({ address }) => client.getBytecode({ address }),
    readInterface: ({ address, interfaceId }) => client.readContract({
      address, abi: READ_ABI, functionName: 'supportsInterface', args: [interfaceId]
    }),
    readIdentity: async ({ address, field }) => {
      try {
        const value = await client.readContract({ address, abi: READ_ABI, functionName: field });
        return typeof value === 'string' ? value.slice(0, 256) : null;
      } catch { return null; }
    },
    inspectRepresentativeToken: async ({ address, startBlock }) => {
      const current = await client.getBlockNumber();
      const toBlock = startBlock + 10_000n < current ? startBlock + 10_000n : current;
      let logs;
      try {
        logs = await client.getLogs({ address, event: TRANSFER_EVENT, fromBlock: startBlock, toBlock, strict: true });
      } catch { return null; }
      for (const log of logs.slice(0, 32)) {
        const tokenId = log.args.tokenId;
        if (tokenId === undefined) continue;
        try {
          await client.readContract({ address, abi: READ_ABI, functionName: 'ownerOf', args: [tokenId] });
          try {
            const uri = await client.readContract({ address, abi: READ_ABI, functionName: 'tokenURI', args: [tokenId] });
            return { tokenId, tokenUriKind: tokenUriKind(uri) };
          } catch { return { tokenId, tokenUriKind: 'REVERTED' }; }
        } catch { continue; }
      }
      return null;
    }
  };

  const results = await verifyNftTechnicalBatch(candidates, {
    rpc,
    provenance: {
      readCreationProvenance: async (address): Promise<NftCreationProvenance> => {
        const addressUrl = new URL(`${blockscoutBase.replace(/\/$/, '')}/addresses/${address}`);
        const addressRecord = await boundedJson(addressUrl);
        const deploymentTransaction = transactionHash(addressRecord.creation_transaction_hash);
        const transactionUrl = new URL(`${blockscoutBase.replace(/\/$/, '')}/transactions/${deploymentTransaction}`);
        const transactionRecord = await boundedJson(transactionUrl);
        const blockNumber = typeof transactionRecord.block === 'number' && Number.isSafeInteger(transactionRecord.block)
          ? BigInt(transactionRecord.block)
          : typeof transactionRecord.block_number === 'number' && Number.isSafeInteger(transactionRecord.block_number)
            ? BigInt(transactionRecord.block_number)
            : null;
        const creator = optionalAddress(addressRecord.creator_address_hash);
        if (creator === null) throw new NftVerificationMalformedProviderResponseError('Blockscout omitted a valid creator address.');
        const implementationAddress = optionalAddress(addressRecord.implementation_address);
        return {
          deploymentTransaction,
          startBlock: blockNumber,
          creator,
          proxyDetected: implementationAddress ? 'YES' : 'UNKNOWN',
          implementationAddress
        };
      }
    }
  });
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, chainId: 4663, results }, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2)}\n`);
}

await main();
