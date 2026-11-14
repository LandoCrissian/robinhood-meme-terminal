import Link from "next/link";

export default function LaunchNotFound() {
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <div className="lpEmpty">
      <h2>No verified RMT registration for this address</h2>
      <p>The directory covers verified RMT factory records. New or unindexed registrations may be unavailable here.</p>
    </div>
  </>;
}
