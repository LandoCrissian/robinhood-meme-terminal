import type { Metadata } from "next";
import { ShowcaseAccount } from "../_components/launch-showcase";

export const metadata: Metadata = { title: "Wallet | RMT Launch" };

export default function WalletPage() {
  return <ShowcaseAccount page="Wallet" />;
}
