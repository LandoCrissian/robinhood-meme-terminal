import { describeCurveLifecycle, hasCurveRegistration, type CurveLaunch } from "../../lib/curve-lifecycle";
import { robinhoodExplorer } from "./launch-evidence";
import { ChainTime } from "./launch-freshness";
import { CreatorLink } from "./creator-link";

const units = (value: string) => {
  const padded = value.padStart(19, "0"), fraction = padded.slice(-18).replace(/0+$/, "");
  return BigInt(padded.slice(0, -18)).toLocaleString("en-US") + (fraction ? "." + fraction : "");
};

/** Full records remain available inside the token page's Contract details disclosure. */
export function LaunchProvenance({ launch }: { launch: CurveLaunch }) {
  if (!hasCurveRegistration(launch.registration)) return <p role="status">Launch evidence is unavailable.</p>;
  const { registration: record } = launch;
  const lifecycle = describeCurveLifecycle(launch);
  return <section className="lpPanel lpForm" aria-label="Verified launch evidence">
    <h2>On-chain evidence</h2>
    <dl className="lpFacts">
      <dt>Lifecycle</dt><dd>{lifecycle.label}</dd>
      <dt>Network</dt><dd>Robinhood Chain {record.chainId}</dd>
      <dt>Token address</dt><dd><a className="lpAddress" href={`${robinhoodExplorer}/address/${record.token}`}>{record.token}</a></dd>
      <dt>Fixed supply</dt><dd>{units(record.totalSupplyWei)} tokens · {record.tokenDecimals} decimals</dd>
      <dt>Creator</dt><dd><CreatorLink wallet={record.creator} label={record.creator} /></dd>
      <dt>Factory</dt><dd><code className="lpAddress">{record.factory}</code></dd>
      <dt>Project registry</dt><dd><code className="lpAddress">{record.projectRegistry}</code></dd>
      <dt>Initial curve</dt><dd><code className="lpAddress">{record.initialCurve}</code> · V{record.engineVersion}</dd>
      <dt>Creation receipt</dt><dd><a className="lpAddress" href={`${robinhoodExplorer}/tx/${record.creation.transactionHash}`}>{record.creation.transactionHash}</a></dd>
      <dt>Creation block / log</dt><dd>{record.creation.blockNumber} / {record.creation.logIndex} · <ChainTime value={record.creation.timestamp} /></dd>
      <dt>Creation block hash</dt><dd><code className="lpAddress">{record.creation.blockHash}</code></dd>
      <dt>Indexed checkpoint</dt><dd>{record.checkpoint.blockNumber} · <ChainTime value={record.checkpoint.timestamp} /></dd>
      <dt>Checkpoint hash</dt><dd><code className="lpAddress">{record.checkpoint.blockHash}</code></dd>
      <dt>Observed confirmations</dt><dd>{record.checkpoint.confirmations} · L2 confirmed</dd>
      <dt>Ethereum L1 finality</dt><dd>Unverified</dd>
    </dl>
    {(lifecycle.stage === "active" || lifecycle.stage === "graduating") && <dl className="lpFacts">
      <dt>Current curve</dt><dd><code className="lpAddress">{lifecycle.observation.engine}</code> · V{lifecycle.observation.version}</dd>
      <dt>Tokens sold</dt><dd>{units(lifecycle.observation.soldWei)} / {units(lifecycle.observation.targetSoldWei)}</dd>
      <dt>Actual ETH backing</dt><dd>{units(lifecycle.observation.backingWei)} / {units(lifecycle.observation.targetBackingWei)} ETH</dd>
      <dt>Curve observation</dt><dd>Block {lifecycle.observation.at.blockNumber} · <ChainTime value={lifecycle.observation.at.timestamp} /></dd>
      <dt>Observation hash</dt><dd><code className="lpAddress">{lifecycle.observation.at.blockHash}</code></dd>
    </dl>}
    {lifecycle.stage === "graduated" && <dl className="lpFacts">
      <dt>Graduation receipt</dt><dd><a className="lpAddress" href={`${robinhoodExplorer}/tx/${lifecycle.observation.receipt.transactionHash}`}>{lifecycle.observation.receipt.transactionHash}</a></dd>
      <dt>Graduation block / log</dt><dd>{lifecycle.observation.receipt.blockNumber} / {lifecycle.observation.receipt.logIndex} · <ChainTime value={lifecycle.observation.receipt.timestamp} /></dd>
      <dt>Graduation block hash</dt><dd><code className="lpAddress">{lifecycle.observation.receipt.blockHash}</code></dd>
      <dt>Graduation engine</dt><dd><code className="lpAddress">{lifecycle.observation.engine}</code> · V{lifecycle.observation.version}</dd>
      <dt>PoolManager</dt><dd><code className="lpAddress">{lifecycle.observation.market.poolManager}</code></dd>
      <dt>Pool ID</dt><dd><code className="lpAddress">{lifecycle.observation.market.poolId}</code></dd>
      <dt>Pool currency0</dt><dd><code className="lpAddress">{lifecycle.observation.market.poolKey.currency0}</code></dd>
      <dt>Pool currency1</dt><dd><code className="lpAddress">{lifecycle.observation.market.poolKey.currency1}</code></dd>
      <dt>Pool fee / tick spacing</dt><dd>{lifecycle.observation.market.poolKey.fee} / {lifecycle.observation.market.poolKey.tickSpacing}</dd>
      <dt>Pool hook</dt><dd><code className="lpAddress">{lifecycle.observation.market.poolKey.hooks}</code></dd>
      <dt>Starting funded deposits</dt><dd>{units(lifecycle.observation.market.nativeDepositedWei)} ETH · {units(lifecycle.observation.market.tokenDepositedWei)} tokens</dd>
      <dt>Initial position</dt><dd>#{lifecycle.observation.market.positionId} · <code className="lpAddress">{lifecycle.observation.market.positionManager}</code></dd>
      <dt>Observed position owner</dt><dd><code className="lpAddress">{lifecycle.observation.market.owner}</code></dd>
      <dt>Observed position liquidity</dt><dd>{lifecycle.observation.market.liquidity}</dd>
    </dl>}
    <p>These records describe the displayed blocks. Ethereum L1 settlement has not been verified. Initial liquidity deposits are not current pool reserves.</p>
  </section>;
}
