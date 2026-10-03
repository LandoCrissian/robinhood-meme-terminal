import Link from "next/link";
import { searchProjects, type RmtProjectIdentity } from "@rmt/shared/project-identity";
import { projectComposition } from "../../lib/vnext/project-presentation";
import { ProjectArtwork } from "./project-artwork";
import { TerminalIcon } from "./terminal-icon";
import "../projects/projects.css";

export function ProjectCard({ project }: { project: RmtProjectIdentity }) {
  const { tokens, collections } = projectComposition(project);
  const paired = tokens.length > 0 && collections.length > 0;
  return <Link className="rmtProjectRow" href={`/projects/${project.projectId}`} aria-label={`Explore ${project.displayName} project`} data-project-id={project.projectId}>
    <ProjectArtwork project={project} />
    <span className="rmtProjectRowIdentity"><strong>{project.displayName}</strong><span className="rmtProjectRowAssets">{tokens.length ? <><span>{tokens.map(asset => asset.symbol ?? asset.name).join(" · ")}</span>{collections.length ? <b aria-label="Connected to"> ↔ </b> : null}</> : null}<span>{collections.map(asset => asset.name ?? asset.symbol).join(" · ")}</span></span></span>
    <span className="rmtProjectRowComposition"><strong>{paired ? "Token + NFT" : collections.length ? "NFT-led" : "Token-led"}</strong><small>{collections.length} {collections.length === 1 ? "collection" : "collections"}</small></span>
    <TerminalIcon name="chevron" />
  </Link>;
}
export function ProjectDiscovery({ query = "", heading = true }: { query?: string; heading?: boolean }) {
  const projects = searchProjects(query); if (!projects.length) return null;
  return <section className="rmtProjectDiscovery" aria-label="Verified projects">{heading ? <header><h2>Projects</h2><span>Tokens &amp; collections</span></header> : null}<div className="rmtProjectScanner">{projects.map(project => <ProjectCard key={project.projectId} project={project} />)}</div></section>;
}
