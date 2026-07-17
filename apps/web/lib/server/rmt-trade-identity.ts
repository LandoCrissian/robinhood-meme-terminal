import { createPublicClient, http, type Address } from "viem";
import { rmtLaunchFactoryV6Abi } from "../contracts";
import { activeChain } from "../network";
import { resolveActiveFactory } from "./launch-feed";

const client = createPublicClient({
  chain: activeChain,
  transport: http(process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? activeChain.rpcUrls.default.http[0], { retryCount: 3, timeout: 12_000 })
});

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

export async function verifyActiveV6LaunchIdentity(params: { launchId: bigint; token: Address }) {
  const activeFactory = await resolveActiveFactory();
  if (!activeFactory || activeFactory.version !== 6) throw new Error("The active V6 factory could not be verified.");
  const launch = await client.readContract({ address: activeFactory.address, abi: rmtLaunchFactoryV6Abi, functionName: "getLaunch", args: [params.launchId] });
  if (!sameAddress(launch.token, params.token)) throw new Error("This token is not the requested active V6 launch.");
  return launch;
}

