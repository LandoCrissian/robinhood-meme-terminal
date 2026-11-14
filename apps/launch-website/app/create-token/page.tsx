import type { Metadata } from "next";
import Link from "next/link";
import { CreatorDraft } from "../_components/creator-draft";

export const metadata: Metadata = { title: "Create Token | RMT Launch" };

export default function CreateTokenPage() {
  return <>
    <header className="lpPageHeading">
      <div><h1>Create Token</h1><p>Prepare a token draft for the new bonding-curve engine.</p></div>
      <Link className="lpButton lpSecondary" href="/" prefetch={false}>Browse launches</Link>
    </header>
    <p className="lpNotice">Prelaunch · Read-only. Token creation is disabled. Drafts do not publish a listing.</p>
    <CreatorDraft />
  </>;
}
