import Link from "next/link";

export function CreatorLink({ wallet, label }: { wallet: string; label?: string }) {
  return <Link className="lpCreatorLink" href={`/creator/${wallet}`} prefetch={false} title={wallet}>{label ?? wallet.slice(0, 6) + "…" + wallet.slice(-4)}</Link>;
}
