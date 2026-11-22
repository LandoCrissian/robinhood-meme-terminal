"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { hasCurveRegistration, type CurveLaunch, type NewEngineDirectory } from "../../lib/curve-lifecycle";
import { sameAccount } from "../../lib/profile-wallet";
import { useAccount } from "./account-provider";
import { NewEngineLaunches } from "./new-engine-launches";
import { WalletAccount } from "./wallet-account";
import { MyLaunchesNav } from "./my-launches-nav";

export function MyLaunches() {
  const { session, checking } = useAccount();
  const [directory, setDirectory] = useState<NewEngineDirectory>({ status: "unavailable" }), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null), [stale, setStale] = useState(false);
  const generation = useRef(0);
  const address = session.authenticated ? session.account.walletAddress : undefined;
  useEffect(() => {
    const version = ++generation.current;
    if (!address) { setDirectory({ status: "unavailable" }); setCursor(null); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true); setDirectory({ status: "unavailable" });
    setCursor(null); setStale(false);
    fetch("/api/launchpad/earnings?recipient=" + address, { cache: "no-store", redirect: "error", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Launch evidence unavailable");
      const payload = await response.json() as { status: string; launches: unknown[]; nextCursor: string | null };
      if (!["ready", "stale"].includes(payload.status) || !Array.isArray(payload.launches) || payload.launches.length > 50
        || (payload.nextCursor !== null && (typeof payload.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,768}$/.test(payload.nextCursor)))) throw new Error("Launch evidence unavailable");
      const launches = payload.launches.map((value): CurveLaunch => {
        if (!value || typeof value !== "object") throw new Error("Invalid registration");
        const launch = "registration" in value ? value as CurveLaunch : { registration: value as CurveLaunch["registration"], state: "created" as const };
        if (!hasCurveRegistration(launch.registration)) throw new Error("Invalid registration");
        return launch;
      });
      if (active && version === generation.current) { setDirectory({ status: "ready", launches: launches.filter((launch) => sameAccount(launch.registration.creator, address)) }); setCursor(payload.nextCursor); setStale(payload.status === "stale"); }
    }).catch(() => { if (active) setDirectory({ status: "unavailable" }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [address, revision]);
  async function more() {
    if (!address || !cursor || directory.status !== "ready") return;
    const version = generation.current; setLoading(true);
    try {
      const response = await fetch(`/api/launchpad/earnings?recipient=${address}&after=${encodeURIComponent(cursor)}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
      const result = await response.json() as { status: string; launches: CurveLaunch["registration"][]; nextCursor: string | null };
      if (!response.ok || !["ready", "stale"].includes(result.status) || !Array.isArray(result.launches) || result.launches.length > 50
        || result.launches.some(row => !hasCurveRegistration(row)) || (result.nextCursor !== null && !/^[A-Za-z0-9_-]{1,768}$/.test(result.nextCursor))) throw new Error("Page unavailable");
      if (version !== generation.current) return;
      const additions: CurveLaunch[] = result.launches.filter(row => sameAccount(row.creator, address)).map(registration => ({ registration, state: "created" }));
      const all = [...(directory.launches.length >= 100 ? [] : directory.launches), ...additions];
      if (new Set(all.map(row => row.registration.token.toLowerCase())).size !== all.length) throw new Error("Checkpoint changed");
      setDirectory({ status: "ready", launches: all }); setCursor(result.nextCursor); setStale(result.status === "stale");
    } catch { if (version === generation.current) setStale(true); }
    finally { if (version === generation.current) setLoading(false); }
  }
  return <>
    <header className="lpPageHeading"><div><h1>My Launches</h1><p>Projects created by your signed-in wallet.</p></div>
      <Link className="lpButton" href="/create-token" prefetch={false}>Prepare a draft</Link></header>
    <MyLaunchesNav active="projects" />
    {checking ? <div className="lpSkeleton" role="status">Checking your account…</div> : !session.authenticated ? <WalletAccount compact /> : <>
      <p className="lpWalletLine">Creator wallet <code>{address?.slice(0,6)}…{address?.slice(-4)}</code></p>
      {loading ? <div className="lpSkeleton" role="status">Loading verified creator launches…</div> : <NewEngineLaunches directory={stale && directory.status==="ready" ? {status:"stale",history:directory.launches.map(({registration})=>({registration,state:"unknown"}))} : directory} onRetry={()=>setRevision(value=>value+1)} />}
      <div className="lpDraftActions"><button type="button" className="lpButton lpSecondary" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Refresh launches</button>
        {cursor && <button type="button" className="lpButton lpSecondary" disabled={loading} onClick={() => void more()}>{directory.status === "ready" && directory.launches.length >= 100 ? "Next project window" : "Load more projects"}</button>}
        <Link className="lpButton lpSecondary" href="/account/profile" prefetch={false}>Edit creator profile</Link></div>
      <details className="lpDisclosure"><summary>Data status</summary><p>{stale ? "The last records could not be refreshed." : "Projects are matched to the creator address in their registration."} Load more to browse older registrations.</p></details>
    </>}
    <section className="lpPanel lpForm" style={{ marginTop: 18 }}><h2>Token draft</h2><p>Continue a saved draft in this browser. Artwork becomes public when you save the image.</p><Link className="lpBack" href="/create-token" prefetch={false}>Continue your token draft →</Link></section>
  </>;
}
