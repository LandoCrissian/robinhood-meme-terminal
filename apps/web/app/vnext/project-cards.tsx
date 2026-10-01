import Link from "next/link";
import { searchProjects, type RmtProjectIdentity } from "@rmt/shared/project-identity";
import { TerminalIcon } from "./terminal-icon";
import "../projects/projects.css";

export function ProjectCard({ project }: { project: RmtProjectIdentity }) {
  const tokens = project.assets.filter(asset => asset.kind === "ERC20"), nfts = project.assets.filter(asset => asset.kind !== "ERC20");
  return <Link className="rmtProjectCard" href={`/projects/${project.projectId}`} aria-label={`Explore ${project.displayName} project`}>
    <span className="rmtProjectMonogram" aria-hidden="true">{project.displayName.slice(0, 2).toUpperCase()}</span>
    <div className="rmtProjectCardBody"><small>{project.projectId === "ccff00" ? "RMT ecosystem · NFT-led" : "Token ↔ NFT Project Market"}</small><strong>{project.displayName}</strong><div className={`rmtProjectPair${tokens.length ? "" : " isNftLed"}`}>{tokens.length ? <><div><small>Token{tokens.length > 1 ? "s" : ""}</small>{tokens.map(asset => <span key={asset.contract}>{asset.symbol ?? asset.name ?? asset.contract}</span>)}</div><TerminalIcon name="project" /></> : null}<div><small>NFT collection{nfts.length > 1 ? "s" : ""}</small>{nfts.map(asset => <span key={asset.contract}>{asset.name ?? asset.symbol ?? asset.contract}</span>)}</div></div></div><TerminalIcon name="chevron" />
  </Link>;
}
export function ProjectDiscovery({ query = "", heading = true }: { query?: string; heading?: boolean }) {
  const projects = searchProjects(query);
  if (!projects.length) return null;
  return <section className="rmtProjectDiscovery" aria-label="Verified projects">{heading ? <header><h2>Project Markets</h2><span>Verified tokens and NFT collections</span></header> : null}<div className="rmtProjectGrid">{projects.map(project => <ProjectCard project={project} key={project.projectId} />)}</div></section>;
}
