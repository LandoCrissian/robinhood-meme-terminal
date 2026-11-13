import { ProductCreate } from "../_components/launch-product";
import { ShowcaseCreate } from "../_components/launch-showcase";
import { isLaunchShowcase } from "../../../lib/server/launchpad-site-mode";

export default function CreateTokenPage() {
  return isLaunchShowcase() ? <ShowcaseCreate /> : <ProductCreate />;
}
