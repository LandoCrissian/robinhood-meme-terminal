import type { VerifiedTokenProject } from "../lib/project-page";

export function ProjectModuleGrid({ project }: { project: VerifiedTokenProject }) {
  return (
    <section className="panel projectModulePanel" aria-labelledby="project-modules-title">
      <header>
        <div>
          <p className="eyebrow">PROJECT ECOSYSTEM</p>
          <h2 id="project-modules-title">One home. Optional creator modules.</h2>
          <p>The token is live now. NFTs, marketplace and music remain inactive until reviewed owner controls and their contracts are ready.</p>
        </div>
        <span>{project.official ? "RMT REFERENCE PROJECT" : "RMT-NATIVE PROJECT"}</span>
      </header>
      <div className="projectModuleGrid">
        {project.modules.map((module) => (
          <article className={`projectModuleCard ${module.status}`} key={module.id}>
            <div><span>{module.status === "live" ? "LIVE" : "PLANNED"}</span><strong>{module.label}</strong></div>
            <p>{module.description}</p>
            {module.status === "live" ? <a href="#trade">Open live market ↓</a> : <small>Not activated · no fee charged</small>}
          </article>
        ))}
      </div>
      <p className="projectControlBoundary">Creator controls unlock only after profile review and page assignment. Future one-time activation fees require an explicit owner transaction and never activate a module by default.</p>
    </section>
  );
}
