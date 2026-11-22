import { reviewLaunches } from "../../../lib/server/public-review";
import { notFound } from "next/navigation";
import { CreatorProfile } from "../../_components/creator-profile";
import { creatorMetadata, readCreator } from "../../../lib/server/social-pages";

export async function generateMetadata({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(wallet) || /^0x0{40}$/i.test(wallet)) notFound();
  return creatorMetadata("creator", wallet.toLowerCase());
}

export default async function WalletCreatorPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(wallet) || /^0x0{40}$/i.test(wallet)) notFound();
  const found = await readCreator("creator", wallet.toLowerCase());
  return <CreatorProfile key={wallet.toLowerCase()} walletAddress={wallet.toLowerCase()} reviewFeed={found.status === "ready" ? await reviewLaunches(found.profile.walletAddress) : undefined} initialProfile={found.status === "ready" ? found.profile : undefined} />;
}
