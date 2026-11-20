import { parseAbi, type Hex } from "viem";
import type { EarningsRpc } from "./earnings-contracts";

export type NitroZeroPosterPolicy = { profile: "nitro-zero-poster-v1"; chainId: 4663;
  l1BaseFeeWei: "0"; l1CalldataUnitWei: "0"; l2BaseFeeWei: string; nativeL2BaseFeeWei: string; blockNumber: string; blockHash: Hex };
export const arbGasInfo = "0x000000000000000000000000000000000000006c" as const;
export const arbGasInfoAbi = parseAbi(["function getL1BaseFeeEstimate() view returns(uint256)",
  "function getPricesInWei() view returns(uint256,uint256,uint256,uint256,uint256,uint256)"]);
function must(value: unknown): asserts value { if (!value) throw Error("Canonical native zero-poster fee evidence unavailable"); }

/** Native ArbGasInfo parameters at the transaction quote's exact canonical
 * block. This proves a measured zero rate; it never substitutes zero for a
 * missing RPC result. Callers must also corroborate transaction-specific C8
 * components and every positive pricing observation on both providers. The
 * header and native state prices are recorded separately from the C8 simulation
 * price; their different semantics do not imply equality. L1 posting price is
 * distinct from L1 finality. */
export async function readNitroZeroPosterPolicy(rpc: EarningsRpc, blockNumber: bigint): Promise<NitroZeroPosterPolicy> {
  const [chain, before, l1, prices] = await Promise.all([rpc.getChainId(), rpc.getBlock({ blockNumber }),
    rpc.readContract({ address: arbGasInfo, abi: arbGasInfoAbi, functionName: "getL1BaseFeeEstimate", blockNumber }),
    rpc.readContract({ address: arbGasInfo, abi: arbGasInfoAbi, functionName: "getPricesInWei", blockNumber })]);
  must(chain === 4663 && before.number === blockNumber && before.hash && /^0x[0-9a-f]{64}$/i.test(before.hash)
    && !/^0x0+$/.test(before.hash) && l1 === 0n && prices.length === 6
    && prices.every(price => typeof price === "bigint" && price >= 0n && price < 2n ** 256n)
    && prices[1] === 0n && prices[5] > 0n && prices[3] + prices[4] === prices[5]
    && typeof before.baseFeePerGas === "bigint" && before.baseFeePerGas > 0n);
  const after = await rpc.getBlock({ blockNumber });
  must(after.number === blockNumber && after.hash?.toLowerCase() === before.hash.toLowerCase() && after.baseFeePerGas === before.baseFeePerGas);
  return { profile: "nitro-zero-poster-v1", chainId: 4663, l1BaseFeeWei: "0", l1CalldataUnitWei: "0",
    l2BaseFeeWei: before.baseFeePerGas.toString(), nativeL2BaseFeeWei: prices[5].toString(), blockNumber: blockNumber.toString(), blockHash: before.hash };
}
