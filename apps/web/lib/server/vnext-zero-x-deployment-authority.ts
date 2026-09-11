import { encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { TradeExecutionFailure, type TradeFailureStage } from "../vnext/trade-failure";
import { ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH } from "./vnext-zero-x-execution-decoder";

// Official registry: https://github.com/0xProject/0x-settler#how-do-i-find-the-most-recent-deployment
export const ZERO_X_DEPLOYMENT_REGISTRY = "0x00000000000004533Fe15556B1E086BB1A72cEae";
const registryAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function prev(uint128) view returns(address)"]);
type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** Registry eligibility is necessary, NOT sufficient to admit a runtime/decoder. */
export async function requireZeroXDeployment(target: Address, rpc: Rpc, stage: TradeFailureStage = "verification"): Promise<{ block: Hex; current: Address; previous: Address | null; runtimeHash: Hex }> {
  let block: Hex;
  let current: Address;
  let previous: Address | null = null;
  const decodeAddress = (value: unknown) => {
    if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) throw new Error();
    const address = getAddress(`0x${value.slice(-40)}`);
    if (address === zeroAddress) throw new Error();
    return address;
  };
  try {
    const chain = await rpc("eth_chainId", []);
    if (chain !== "0x1237") throw new Error();
    const height = await rpc("eth_blockNumber", []);
    if (typeof height !== "string" || !/^0x[0-9a-fA-F]+$/.test(height)) throw new Error();
    block = height as Hex;
    // Never consult prev after a reverting/malformed current lookup (pause).
    current = decodeAddress(await rpc("eth_call", [{ to: ZERO_X_DEPLOYMENT_REGISTRY,
      data: encodeFunctionData({ abi: registryAbi, functionName: "ownerOf", args: [2n] }) }, block]));
    if (getAddress(target) !== current) previous = decodeAddress(await rpc("eth_call", [{ to: ZERO_X_DEPLOYMENT_REGISTRY,
      data: encodeFunctionData({ abi: registryAbi, functionName: "prev", args: [2n] }) }, block]));
  } catch { throw new TradeExecutionFailure("SETTLER_REGISTRY_UNAVAILABLE", stage); }
  if (getAddress(target) !== current && getAddress(target) !== previous) throw new TradeExecutionFailure("SETTLER_UNREGISTERED", stage);
  const code = await rpc("eth_getCode", [target, block]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new TradeExecutionFailure("CONTRACT_VERSION_UNSUPPORTED", stage);
  const runtimeHash = keccak256(code as Hex);
  // Reviewed RobinHoodSettler commit 95184a23336b52d99aaa528c5b1259e3bb04eafe.
  // The existing decoder review establishes the final post-action/post-fee minimum.
  // A newly registered deployment is NOT admitted just because its ABI looks similar.
  if (runtimeHash !== ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH) throw new TradeExecutionFailure("CONTRACT_VERSION_UNSUPPORTED", stage);
  return { block, current, previous, runtimeHash };
}
