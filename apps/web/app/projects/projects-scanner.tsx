"use client";
import { useState } from "react";
import { searchProjects } from "@rmt/shared/project-identity";
import { ProjectCard } from "../vnext/project-cards";

const filters = ["All", "Token + NFT", "NFT-led"] as const;
export function ProjectsScanner({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const projects = searchProjects(query).filter(project => filter === "All" || (project.assets.some(asset => asset.kind === "ERC20") ? filter === "Token + NFT" : filter === "NFT-led"));
  return <section aria-label="Project directory" className="rmtProjectsDirectory">
    <nav className="rmtProjectFilters" aria-label="Project composition">{filters.map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</nav>
    <div className="rmtProjectsSearch"><label className="vnSrOnly" htmlFor="project-search">Find a project or asset</label><input id="project-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search project, token or NFT contract" maxLength={160} autoComplete="off" spellCheck={false} /><span aria-live="polite">{projects.length}</span></div>
    <div className="rmtProjectScannerHead" aria-hidden="true"><span>Project</span><span>Connected assets</span><span>Composition</span></div>
    <div className="rmtProjectScanner" aria-label="Verified projects">{projects.map(project => <ProjectCard key={project.projectId} project={project} />)}</div>
    {!projects.length ? <p className="rmtProjectQuietState rmtProjectNoResults">No project found.</p> : null}
  </section>;
}
