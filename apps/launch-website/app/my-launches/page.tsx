import type { Metadata } from "next";
import { ShowcaseAccount } from "../_components/launch-showcase";

export const metadata: Metadata = { title: "My Launches | RMT Launch" };

export default function MyLaunchesPage() {
  return <ShowcaseAccount page="My Launches" />;
}
