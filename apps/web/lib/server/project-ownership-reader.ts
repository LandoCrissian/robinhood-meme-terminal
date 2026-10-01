import { createPublicClient, getAddress, http, parseAbi, type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { projectById } from "@rmt/shared/project-identity";
import { summarizeProjectOwnership, type ProjectAssetOwnership } from "@rmt/shared/project-ownership";
import { readRmtNftWalletOwnership, readRmtNftProjectIdentity } from "./nft-project-market";

const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const rpc = () => createPublicClient({ chain: robinhoodChain, transport: http(process.env.RMT_MAINNET_RPC_URL?.trim() || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim() || process.env.NEXT_PUBLIC_RMT_RPC_URL?.trim() || robinhoodChain.rpcUrls.default.http[0], { batch: false, timeout: 5_000, retryCount: 1 }) });
export async function readProjectOwnership(projectId: string, wallet: Address, options: {
  client?: ReturnType<typeof rpc>; readIndexed?: typeof readRmtNftWalletOwnership; now?: () => Date;
} = {}) {
  const project = projectById(projectId); if (!project) return null;
  const client = options.client ?? rpc(); const observedAt = (options.now?.() ?? new Date()).toISOString();
  const indexedIdentity = readRmtNftProjectIdentity(projectId);
  const indexedAsset = (contract: Address) => indexedIdentity?.project.collections.some(collection => collection.contractAddress.toLowerCase() === contract.toLowerCase()) === true;
  const unavailable = (contract: Address, indexed = false): ProjectAssetOwnership => ({ chainId: 4663, contract, wallet: getAddress(wallet), state: "UNAVAILABLE", balance: null, blockNumber: null, blockHash: null, observedAt: null, authority: indexed ? "RMT_NFT_INDEXER" : "ONCHAIN_BALANCE" });
  // Admitted collection ownership stays with the existing durable NFT service.
  // Non-indexed graph assets use direct public balanceOf, never profile data.
  let block: Awaited<ReturnType<typeof client.getBlock>> | null = null;
  if (project.assets.some(asset => !indexedAsset(asset.contract) && asset.kind !== "ERC1155")) {
    try { if (await client.getChainId() === 4663) block = await client.getBlock({ blockTag: "latest" }); } catch { /* unknown remains unavailable */ }
  }
  const facts = await Promise.all(project.assets.map(async asset => {
    if (asset.kind !== "ERC20" && indexedAsset(asset.contract)) return await (options.readIndexed ?? readRmtNftWalletOwnership)(projectId, wallet) ?? unavailable(asset.contract, true);
    // ERC1155 requires token-ID-scoped inventory; balanceOf(wallet) would be the
    // wrong ABI and cannot establish the number of project NFTs.
    if (asset.kind === "ERC1155") return unavailable(asset.contract);
    if (!block || block.number === null || block.hash === null) return unavailable(asset.contract);
    try {
      const balance = await client.readContract({ address: asset.contract, abi, functionName: "balanceOf", args: [wallet], blockNumber: block.number });
      return { ...unavailable(asset.contract), state: "READY" as const, balance: balance.toString(), blockNumber: block.number.toString(), blockHash: block.hash, observedAt };
    } catch { return unavailable(asset.contract); }
  }));
  return summarizeProjectOwnership(project, wallet, facts);
}
