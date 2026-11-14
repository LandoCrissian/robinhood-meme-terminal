import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { CreatorDraft } from "../_components/creator-draft";
import { configuredCurveFixture } from "../../lib/server/curve-fixture";

export const metadata: Metadata = { title: "Create Token | RMT Launch" };

export default async function CreateTokenPage() {
  const fixture = configuredCurveFixture(await headers());
  return <>
    <header className="lpPageHeading">
      <div><h1>Create Token</h1><p>Prepare a token draft for the new bonding-curve engine.</p></div>
      <Link className="lpButton lpSecondary" href="/" prefetch={false}>Browse launches</Link>
    </header>
    <p className="lpNotice">{fixture ? "Isolated test mode · Anvil 31337 · synthetic funds only."
      : "Prelaunch · Read-only. Token creation is disabled. Drafts do not publish a listing."}</p>
    <CreatorDraft executionTest={fixture ? { factory: fixture.factory } : undefined} />
  </>;
}
