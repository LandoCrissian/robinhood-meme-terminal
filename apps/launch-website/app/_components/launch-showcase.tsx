import Link from "next/link";
import { launchTerms } from "../../lib/launch-terms";

const numberLabel = (amount: number) => amount.toLocaleString("en-US");

export function ShowcaseCreate() {
  return <>
    <header className="lpPageHeading">
      <div><h1>Create Token</h1><p>Fixed supply, bonding-curve trading and v4 graduation.</p></div>
      <Link className="lpButton lpSecondary" href="/" prefetch={false}>Browse launches</Link>
    </header>
    <p className="lpNotice">Read-only. Token creation is disabled. These proposed terms apply to the future launch engine.</p>
    <div className="lpColumns">
      <section className="lpPanel lpForm">
        <h2>Launch details</h2>
        <dl className="lpFacts">
          <dt>Token details</dt><dd>Choose a name, symbol, and optional project link.</dd>
          <dt>Fixed supply</dt><dd>{launchTerms.supplyPresets.map(numberLabel).join(" / ")} tokens</dd>
          <dt>Optional treasury</dt><dd>Set the project treasury address and its share of collected curve fees.</dd>
          <dt>Creator allocation</dt><dd>0 tokens</dd>
          <dt>Opening real reserve</dt><dd>0 ETH</dd>
        </dl>
      </section>
      <section className="lpPanel lpForm">
        <h2>Draft launch terms</h2>
        <dl className="lpFacts">
          <dt>Proposed creation fee</dt><dd>{launchTerms.creationFeeEth} ETH, plus network gas</dd>
          <dt>Curve trade fee</dt><dd>{launchTerms.curveTradeFeePercent}% of gross ETH</dd>
          <dt>Collected curve fees</dt><dd>{launchTerms.projectFeeSharePercent}% creator/project · {launchTerms.operatingFeeSharePercent}% RMT operations · {launchTerms.futureReserveFeeSharePercent}% RMT future reserve</dd>
          <dt>Graduation</dt><dd>{launchTerms.curveAllocationPercent}% net supply sold · {launchTerms.graduationBackingEth} ETH backing target</dd>
          <dt>Original v4 liquidity</dt><dd>{launchTerms.liquidityAllocationPercent}% of supply before rounding · permanent principal custody</dd>
        </dl>
      </section>
    </div>
  </>;
}

export function ShowcaseAccount({ page }: { page: "Wallet" | "My Launches" }) {
  return <>
    <header className="lpPageHeading"><div><h1>{page}</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>{page === "Wallet" ? "Wallet access" : "Creator tools"}</h2>
      <p>{page === "Wallet" ? "Read-only. Wallet connection and transaction recovery are disabled."
        : "Read-only. Creator tools and fee claims are unavailable while the new launch engine is in prelaunch."}</p>
      <Link className="lpBack" href="/" prefetch={false}>Browse launches</Link>
    </section>
  </>;
}
