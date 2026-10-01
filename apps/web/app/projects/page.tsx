import { ProjectDiscovery } from "../vnext/project-cards";
import { searchProjects } from "@rmt/shared/project-identity";
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams, query = typeof params.q === "string" ? params.q : "";
  return <main className="rmtProjectMarket"><header className="rmtProjectHero"><p>RMT · Robinhood Chain</p><h1>Project Markets</h1><span>Verified tokens and NFT collections, connected.</span></header><form action="/projects" className="rmtProjectSearch"><label htmlFor="project-search">Find a project or asset</label><div><input id="project-search" name="q" defaultValue={query} placeholder="Project, token or NFT contract" maxLength={160} /><button type="submit">Search</button></div></form>{searchProjects(query).length ? <ProjectDiscovery query={query} heading={false} /> : <p>No linked project found.</p>}</main>;
}
