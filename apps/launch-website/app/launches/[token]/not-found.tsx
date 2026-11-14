import Link from "next/link";

export default function LaunchNotFound() {
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <div className="lpEmpty">
      <h2>No verified RMT registration for this address</h2>
      <p>This lookup covers available RMT factory records on Robinhood Chain. External tokens and newer or unindexed records may be absent.</p>
    </div>
  </>;
}
