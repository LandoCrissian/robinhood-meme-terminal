import Link from "next/link";
import { searchProjects, type RmtProjectIdentity } from "@rmt/shared/project-identity";
import { projectComposition } from "../../lib/vnext/project-presentation";
import { ProjectArtwork } from "./project-artwork";
import { TerminalIcon } from "./terminal-icon";
import "../projects/projects.css";

export function ProjectCard({ project }: { project: RmtProjectIdentity }) {
  const { tokens, collections, label } = projectComposition(project);
  return <Link className="rmtProjectCard" href={`/projects/${project.projectId}`} aria-label={`Explore ${project.displayName} project`}>
    <div className="rmtProjectCardIdentity"><ProjectArtwork project={project} priority /><div><small>{label}</small><strong>{project.displayName}</strong></div><TerminalIcon name="chevron" /></div>
    <div className={`rmtProjectPair ${tokens.length && collections.length ? "" : "isNftLed"}`}>
      {tokens.length ? <><div><ProjectArtwork project={project} contract={tokens[0]!.contract} /><span><small>Token</small><span>{tokens.map(asset => asset.symbol ?? asset.name).join(" · ")}</span></span></div>{collections.length ? <span className="rmtProjectConnection" aria-label="Connected project assets">↔</span> : null}</> : null}
      {collections.length ? <div><ProjectArtwork project={project} contract={collections[0]!.contract} /><span><small>NFT collection</small><span>{collections.map(asset => asset.name ?? asset.symbol).join(" · ")}</span></span></div> : null}
    </div>
    <span className="rmtProjectCardDestination">Explore project <TerminalIcon name="chevron" /></span>
  </Link>;
}
export function ProjectDiscovery({ query = "", heading = true }: { query?: string; heading?: boolean }) {
  const projects = searchProjects(query); if (!projects.length) return null;
  return <section className="rmtProjectDiscovery" aria-label="Verified projects">{heading ? <header><h2>Project Markets</h2><span>Connected tokens &amp; collections</span></header> : null}<div className="rmtProjectGrid">{projects.map(project => <ProjectCard key={project.projectId} project={project} />)}</div></section>;
}
