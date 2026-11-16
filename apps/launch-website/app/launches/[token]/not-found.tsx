import Link from "next/link";

export default function LaunchNotFound() {
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <div className="lpEmpty">
      <h2>Launch unavailable</h2>
      <p>RMT Launch is in prelaunch. Public token details will be available after launch creation opens and registrations are verified.</p>
    </div>
  </>;
}
