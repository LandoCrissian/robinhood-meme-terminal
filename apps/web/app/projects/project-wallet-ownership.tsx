"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useRmtIdentity } from "../rmt-identity";
import { selectedVNextWalletReadAddress } from "../../lib/vnext/selected-wallet-read-authority";
import { projectById } from "@rmt/shared/project-identity";
import { parseProjectOwnershipFact, summarizeProjectOwnership } from "@rmt/shared/project-ownership";
import type { readProjectOwnership } from "../../lib/server/project-ownership-reader";
type Ownership = NonNullable<Awaited<ReturnType<typeof readProjectOwnership>>>;
export function ProjectWalletOwnership({ projectId }: { projectId: string }) {
  const identity = useRmtIdentity(), account = useAccount();
  const wallet = selectedVNextWalletReadAddress({ selectedWalletKey: identity.activeWalletKey, selectedWalletKind: identity.activeWalletKind, selectedSignerAuthority: identity.activeSignerAuthority, connectedAddress: account.address, connectedChainId: account.chainId, connectorId: account.connector?.id, connectorType: account.connector?.type, connectorUid: account.connector?.uid, requiredChainId: 4663 });
  const [snapshot, setSnapshot] = useState<{ key: string; data: Ownership | null }>();
  const key = `${projectId}:${wallet ?? "none"}:${identity.activeWalletKey ?? "none"}`;
  useEffect(() => {
    if (!wallet) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); setSnapshot({ key, data: null }); }, 15_000);
    void fetch(`/api/projects/${projectId}/ownership?wallet=${wallet}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Ownership unavailable");
      const data = await response.json() as Ownership;
      const project = projectById(projectId);
      if (!project || !data || data.projectId !== projectId || data.chainId !== 4663 || typeof data.wallet !== "string" || data.wallet.toLowerCase() !== wallet.toLowerCase() || !Array.isArray(data.assets) || data.assets.length !== project.assets.length) throw new Error("Mismatched ownership response");
      const facts = data.assets.flatMap((item, index) => {
        const asset = project.assets[index]!;
        if (item.asset?.contract?.toLowerCase() !== asset.contract.toLowerCase()) throw new Error("Invalid ownership asset");
        if (item.fact === null) return [];
        const fact = parseProjectOwnershipFact(item.fact, asset.contract, wallet);
        if (!fact || (projectId === "ccff00" && fact.authority !== "RMT_NFT_INDEXER")) throw new Error("Invalid ownership fact");
        return [fact];
      });
      if (!controller.signal.aborted) setSnapshot({ key, data: summarizeProjectOwnership(project, wallet, facts) });
    }).catch(() => { if (!controller.signal.aborted) setSnapshot({ key, data: null }); }).finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [key, projectId, wallet]);
  const data = snapshot?.key === key ? snapshot.data : null;
  return <section className="rmtProjectWallet" aria-label="Project ownership"><h2>Your project assets</h2>{!wallet ? <p>Connect your selected wallet to see ownership on Robinhood Chain.</p> : !data ? <p>Ownership {snapshot?.key === key ? "unavailable" : "loading"}.</p> : <><ul>{data.assets.map(item => <li key={item.asset.contract}><strong>{item.asset.symbol ?? item.asset.name}</strong> · {item.holds === null ? "Unavailable" : item.holds ? item.asset.kind === "ERC20" ? "Held" : `${item.fact!.balance} NFTs` : "Not held"}</li>)}</ul><p>Onchain ownership facts. No benefits or eligibility implied.</p></>}</section>;
}
