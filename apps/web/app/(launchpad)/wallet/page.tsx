import { LaunchWalletPage } from "../_components/launch-wallet-page";
import { ShowcaseAccount } from "../_components/launch-showcase";
import { isLaunchShowcase } from "../../../lib/server/launchpad-site-mode";

export default function WalletPage() {
  return isLaunchShowcase() ? <ShowcaseAccount page="Wallet" /> : <LaunchWalletPage />;
}
