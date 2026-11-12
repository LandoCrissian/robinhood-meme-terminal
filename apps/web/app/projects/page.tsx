import { ProjectsScanner } from "./projects-scanner";

// Middleware retires this route. Do not mount its archived wallet layout during build.
export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams, query = typeof params.q === "string" ? params.q : "";
  return <main className="rmtProjectMarket isDiscovery"><header className="rmtProjectsHeading"><h1>Projects</h1><p>Robinhood Chain Project Markets</p></header><ProjectsScanner initialQuery={query} /></main>;
}
