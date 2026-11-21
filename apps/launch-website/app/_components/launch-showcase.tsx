import Link from "next/link";
import { curveShowcaseStage, type CurveShowcaseExample } from "../../lib/curve-showcase";
import { launchTerms } from "../../lib/launch-terms";
import { TokenArtwork } from "./token-artwork";

const numberLabel = (amount: number) => amount.toLocaleString("en-US");

export function ShowcaseCreate() {
  return <>
    <header className="lpPageHeading">
      <div><h1>Create Token</h1><p>Fixed supply, bonding-curve trading and v4 graduation.</p></div>
      <Link className="lpButton lpSecondary" href="/">Browse examples</Link>
    </header>
    <p className="lpNotice">Read-only preview. These proposed launch terms are for review. Token creation is disabled.</p>
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
        <p>In the private test fixture, review the token details, fee recipient and exact creation fee before confirming.</p>
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

export function ShowcaseToken({ example }: { example: CurveShowcaseExample }) {
  const graduated = example.stage === "graduated";
  const graduationSold = example.supply * launchTerms.curveAllocationPercent / 100;
  const progress = example.netSold * 100 / graduationSold;
  // The 2 ETH fixture uses 4 virtual ETH and 180% virtual token inventory.
  // These whole-token examples are chosen to have an exact pre-graduation reserve.
  const virtualTokens = example.supply * 180 / 100;
  const backing = graduated ? 0 : launchTerms.graduationBackingEth * 2 * example.netSold / (virtualTokens - example.netSold);
  return <>
    <Link className="lpBack" href="/">← Launches</Link>
    <header className="lpPageHeading">
      <div className="lpTokenHeading">
        <TokenArtwork symbol={example.symbol} />
        <div><h1>{example.name}</h1><p>{example.symbol}</p></div>
      </div>
      <span className="lpPill">{curveShowcaseStage(example)}</span>
    </header>
    <p className="lpNotice">Read-only preview. This illustrative example has no token contract, pool or transaction history.</p>
    <div className="lpColumns">
      <section className="lpPanel lpForm">
        <h2>Sample launch details</h2>
        <dl className="lpFacts">
          <dt>Fixed supply</dt><dd>{numberLabel(example.supply)} {example.symbol}</dd>
          <dt>Creator allocation</dt><dd>0 {example.symbol}</dd>
          <dt>Net curve tokens sold</dt><dd>{numberLabel(example.netSold)} of {numberLabel(graduationSold)}</dd>
          <dt>Graduation progress</dt><dd>{numberLabel(progress)}%</dd>
          <dt>Curve backing reserve</dt><dd>{numberLabel(backing)} ETH</dd>
          <dt>Graduation backing target</dt><dd>{launchTerms.graduationBackingEth} ETH</dd>
          {graduated && <>
            <dt>Illustrative v4 deposits</dt><dd>≈{launchTerms.graduationBackingEth} ETH · ≈{numberLabel(example.supply - graduationSold)} {example.symbol}</dd>
            <dt>Original position</dt><dd>Permanent principal custody after funding</dd>
            <dt>Pool fee</dt><dd>{launchTerms.graduationPoolFeePercent}%</dd>
          </>}
        </dl>
      </section>
      <section className="lpPanel lpForm lpTradeColumn">
        <h2>{graduated ? "Trade on Uniswap v4" : `Trade ${example.symbol}`}</h2>
        <p>{graduated ? "After verified funding and custody, the graduated token trades in its canonical Uniswap v4 pool."
          : "Buys and sells on the curve change the tracked ETH backing until the token reaches its graduation target."}</p>
        <p>{graduated ? "Only fees earned by the original locked position accrue to its fee ledger."
          : `The proposed curve fee is ${launchTerms.curveTradeFeePercent}% of gross ETH. In the private test fixture, buyers review the quoted output and slippage before confirming.`}</p>
        <p>Trading is disabled in this preview.</p>
      </section>
    </div>
  </>;
}

export function ShowcaseAccount({ page }: { page: "Wallet" | "My Launches" }) {
  return <>
    <header className="lpPageHeading"><div><h1>{page}</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>Private test fixture</h2>
      <p>{page === "Wallet" ? "Read-only preview. Wallet connection and transaction recovery are disabled."
        : "Read-only preview. Creator launches and fee claims are available in the private test fixture."}</p>
      <Link className="lpBack" href="/">Browse sample launches</Link>
    </section>
  </>;
}
