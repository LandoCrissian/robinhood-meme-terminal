import { getAddress, type Hash } from "viem";
import deploymentIdentities from "../../../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";

const { baseSepolia } = deploymentIdentities;

export type LaunchpadRouterVersion = "2.0" | "2.1.2";

export const launchpadRouterPins = {
  "2.0": {
    address: getAddress(baseSepolia.universalRouter.address),
    runtimeHash: baseSepolia.universalRouter.runtimeHash as Hash,
  },
  "2.1.2": {
    address: getAddress(baseSepolia.universalRouter212.address),
    runtimeHash: baseSepolia.universalRouter212.runtimeHash as Hash,
  },
} as const;

export function launchpadRouterVersion(address: string): LaunchpadRouterVersion | undefined {
  const canonical = address.toLowerCase();
  if (canonical === launchpadRouterPins["2.0"].address.toLowerCase()) return "2.0";
  if (canonical === launchpadRouterPins["2.1.2"].address.toLowerCase()) return "2.1.2";
}
