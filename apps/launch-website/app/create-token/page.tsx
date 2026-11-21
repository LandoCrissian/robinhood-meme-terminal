import type { Metadata } from "next";
import { ShowcaseCreate } from "../_components/launch-showcase";

export const metadata: Metadata = { title: "Create Token | RMT Launch" };

export default function CreateTokenPage() {
  return <ShowcaseCreate />;
}
