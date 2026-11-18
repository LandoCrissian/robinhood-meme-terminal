import { notFound } from "next/navigation";
import { CreatorProfile } from "../../_components/creator-profile";

export default async function WalletCreatorPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(wallet) || /^0x0{40}$/i.test(wallet)) notFound();
  return <CreatorProfile walletAddress={wallet.toLowerCase()} />;
}
