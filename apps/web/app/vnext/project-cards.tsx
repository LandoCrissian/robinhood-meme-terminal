import Link from "next/link";
import { searchProjects, type RmtProjectIdentity } from "@rmt/shared/project-identity";
import { TerminalIcon } from "./terminal-icon";
import "../projects/projects.css";

export function ProjectCard({ project }: { project: RmtProjectIdentity }) {
  const tokens = project.assets.filter(asset => asset.kind === "ERC20"), nfts = project.assets.filter(asset => asset.kind !== "ERC20");
  const composition = [tokens.length ? tokens.map(asset => asset.symbol ?? "Token").join(" · ") : null, nfts.length ? `${nfts.length} NFT ${nfts.length === 1 ? "collection" : "collections"}` : null].filter(Boolean).join(" + ");
  return <Link className="rmtProjectCard" href={`/projects/${project.projectId}`} aria-label={`Explore ${project.displayName} project`}>
    <span className="rmtProjectMonogram" aria-hidden="true">{project.displayName.slice(0, 2).toUpperCase()}</span>
    <span><small>{project.projectId === "ccff00" ? "RMT ecosystem · NFT-led" : "Project"}</small><strong>{project.displayName}</strong><span>{composition}</span></span><TerminalIcon name="chevron" />
  </Link>;
}
export function ProjectDiscovery({ query = "", heading = true }: { query?: string; heading?: boolean }) {
  const projects = searchProjects(query);
  if (!projects.length) return null;
  return <section className="rmtProjectDiscovery" aria-label="Verified projects">{heading ? <header><h2>Projects</h2><span>Connected assets on Robinhood Chain</span></header> : null}<div className="rmtProjectGrid">{projects.map(project => <ProjectCard project={project} key={project.projectId} />)}</div></section>;
}
