import type { TokenPresentation } from "../../lib/vnext/token-presentation";
import { safeExternalNavigationUrl } from "../../lib/vnext/external-navigation";

export function TokenInformation({ presentation }: { presentation?: TokenPresentation }) {
  const visual = presentation?.visual;
  const projects = presentation?.project.data ?? [];
  const website = safeExternalNavigationUrl(visual?.data?.websites[0]);
  const twitter = visual?.data?.twitter && /^\w{1,80}$/.test(visual.data.twitter) ? safeExternalNavigationUrl(`https://x.com/${visual.data.twitter}`) : null;
  const telegram = visual?.data?.telegram && /^\w{1,80}$/.test(visual.data.telegram) ? safeExternalNavigationUrl(`https://t.me/${visual.data.telegram}`) : null;
  return <div className="vnTokenInformation" data-token-presentation={presentation?.contract}>
    <p>{visual?.data?.description ?? "No provider description reported."}</p>
    <div className="vnTokenInformationLinks">{[["Website", website], ["X", twitter], ["Telegram", telegram]].map(([label, href]) => href ? <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a> : null)}</div>
    <small>Visual metadata · GeckoTerminal · {visual?.state === "STALE" ? "last observed" : visual?.state === "READY" ? "provider reported" : "unavailable"}. Market data and onchain identity have separate sources.</small>
    <p><small>Market metrics · {presentation?.market.data ? `GeckoTerminal · ${presentation.market.state === "STALE" ? "last observed" : "provider reported"} · ${presentation.market.observedAt}` : "unavailable"}{presentation?.market.data ? ` · pool ${presentation.market.data.pool}` : ""}</small></p>
    {presentation?.market.data && <p><small>24h pool activity · {presentation.market.data.buys24h ?? "—"} buys · {presentation.market.data.sells24h ?? "—"} sells · provider reported. Pool first seen: {presentation.market.data.createdAt ?? "unavailable"}; this is not the token creation date.</small></p>}
    <h3>Project relationships</h3>
    {projects.length ? projects.map(project => <div key={project.projectId}>
      <strong>{project.displayName}</strong>
      <ul>{project.assets.map(asset => <li key={asset.contract}>{asset.kind} · <code>{asset.contract}</code> · {asset.relationship === "OWNER_CONFIRMED_PROJECT_TOKEN" ? "Owner-confirmed project token" : "Owner-approved collection"}</li>)}</ul>
      {project.links.map(link => <a key={link.url} href={safeExternalNavigationUrl(link.url) ?? undefined} target="_blank" rel="noopener noreferrer">{link.label}</a>)}
    </div>) : <p>No owner-confirmed token/project relationship recorded. Matching names do not establish a relationship.</p>}
  </div>;
}
