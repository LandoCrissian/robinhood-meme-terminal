import Link from "next/link";

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
