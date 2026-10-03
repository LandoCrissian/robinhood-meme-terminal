import { ProjectsScanner } from "./projects-scanner";
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams, query = typeof params.q === "string" ? params.q : "";
  return <main className="rmtProjectMarket isDiscovery"><header className="rmtProjectsHeading"><h1>Projects</h1><p>Robinhood Chain Project Markets</p></header><ProjectsScanner initialQuery={query} /></main>;
}
