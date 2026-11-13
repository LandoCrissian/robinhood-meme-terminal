import { ProductDirectory } from "../_components/launch-product";
import { ShowcaseAccount } from "../_components/launch-showcase";
import { isLaunchShowcase } from "../../../lib/server/launchpad-site-mode";

export default function MyLaunchesPage() {
  return isLaunchShowcase() ? <ShowcaseAccount page="My Launches" /> : <ProductDirectory mine />;
}
