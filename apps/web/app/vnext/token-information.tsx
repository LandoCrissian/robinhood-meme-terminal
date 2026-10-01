import type { TokenPresentation } from "../../lib/vnext/token-presentation";
import { safeExternalNavigationUrl } from "../../lib/vnext/external-navigation";
import { TerminalIcon } from "./terminal-icon";
import Link from "next/link";

export function TokenInformation({ presentation }: { presentation?: TokenPresentation }) {
  const visual = presentation?.visual;
  const website = safeExternalNavigationUrl(visual?.data?.websites[0]);
  const twitter = visual?.data?.twitter && /^\w{1,80}$/.test(visual.data.twitter) ? safeExternalNavigationUrl(`https://x.com/${visual.data.twitter}`) : null;
  const telegram = visual?.data?.telegram && /^\w{1,80}$/.test(visual.data.telegram) ? safeExternalNavigationUrl(`https://t.me/${visual.data.telegram}`) : null;
  return <div className="vnTokenInformation" data-token-presentation={presentation?.contract}>
    {visual?.data?.description ? <p>{visual.data.description}</p> : null}
    <div className="vnTokenInformationLinks">{([{ name: "website", label: "Website", href: website }, { name: "x", label: "X", href: twitter }, { name: "telegram", label: "Telegram", href: telegram }] as const).map(link => link.href ? <a className="rmtIconButton" key={link.name} href={link.href} aria-label={link.label} title={link.label} target="_blank" rel="noopener noreferrer"><TerminalIcon name={link.name} /></a> : null)}</div>
  </div>;
}

export function ProjectInformation({ presentation }: { presentation?: TokenPresentation }) {
  const projects = presentation?.project.data ?? [];
  return <section className="vnWorkspaceCard vnProjectSurface" data-project-graph="presentation-only">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Ecosystem</span><h3>Project</h3></div><TerminalIcon name="project" /></header>
    {projects.length ? projects.map(project => <article className="vnProjectIdentity" key={project.projectId}>
      <h4>{project.displayName}</h4>
      <div className="vnProjectAssets">{project.assets.map(asset => <Link href={asset.kind === "ERC20" ? `/?market=${asset.contract}&project=${project.projectId}` : `/projects/${project.projectId}#${asset.contract.toLowerCase()}`} key={asset.contract}><TerminalIcon name={asset.kind === "ERC20" ? "market" : "project"} /><span><strong>{asset.kind === "ERC20" ? "Token" : "NFT collection"}</strong><span>{asset.symbol ?? asset.name ?? `${asset.contract.slice(0, 6)}…${asset.contract.slice(-4)}`}</span></span><TerminalIcon name="chevron" /></Link>)}</div>
      <Link className="rmtProjectExplore" href={`/projects/${project.projectId}`}>Explore project <TerminalIcon name="chevron" /></Link>
      {project.links.map(link => { const href = safeExternalNavigationUrl(link.url); return href ? <a key={link.url} href={href} target="_blank" rel="noopener noreferrer">{link.label} <TerminalIcon name="external" /></a> : null; })}
      <details className="vnEvidenceDetails"><summary>Evidence &amp; Sources</summary><p>Owner-confirmed project relationships · presentation only</p>{project.assets.map(asset => <p key={asset.contract}><code>{asset.contract}</code><br />{asset.relationship} · {asset.observedAt}</p>)}{project.officialEvidence.map(item => <a href={safeExternalNavigationUrl(item.url) ?? undefined} key={item.url} target="_blank" rel="noopener noreferrer">{item.kind}</a>)}</details>
    </article>) : <p className="vnCompactEmpty">Project not linked yet</p>}
    <TokenInformation presentation={presentation} />
  </section>;
}

export function PresentationSources({ presentation }: { presentation?: TokenPresentation }) {
  return <dl className="vnSourceFacts">
    <div><dt>Identity</dt><dd>{presentation?.identity.provenance ?? "Onchain / directory evidence"} · {presentation?.identity.state ?? "Unavailable"}</dd></div>
    <div><dt>Visual metadata</dt><dd>{presentation?.visual.provenance ?? "GeckoTerminal"} · {presentation?.visual.state ?? "Unavailable"}</dd></div>
    <div><dt>Market</dt><dd>{presentation?.market.provenance ?? "GeckoTerminal"} · {presentation?.market.state ?? "Unavailable"}<br />{presentation?.market.observedAt ?? "No observation"}</dd></div>
    <div><dt>Pool</dt><dd>{presentation?.market.data?.pool ?? "No pool attached"}</dd></div>
    <div><dt>Project relationship</dt><dd>{presentation?.project.data?.length ? [...new Set(presentation.project.data.flatMap(project => project.assets.map(asset => asset.relationship)))].join(" · ") : "No owner-confirmed relationship recorded. Names do not establish a relationship."}</dd></div>
  </dl>;
}
