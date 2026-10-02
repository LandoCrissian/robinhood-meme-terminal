"use client";
import { useState } from "react";
import type { RmtProjectIdentity } from "@rmt/shared/project-identity";
import { projectArtworkCandidates } from "../../lib/vnext/project-presentation";

export function ProjectArtwork({ project, contract, className = "", priority = false }: {
  project: RmtProjectIdentity; contract?: string; className?: string; priority?: boolean;
}) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState<readonly string[]>([]);
  const source = projectArtworkCandidates(project, contract).find(url => !failed.includes(url));
  const asset = project.assets.find(asset => asset.contract.toLowerCase() === contract?.toLowerCase());
  const label = asset?.name ?? project.displayName;
  return <span className={`rmtProjectArt ${className}`} data-artwork-state={source ? loaded.includes(source) ? "image" : "loading" : "fallback"}>
    {!source ? <span className="rmtProjectArtFallback" aria-hidden="true">{label.slice(0, 2).toUpperCase()}</span> : null}
    {source ? <img src={source} alt={`${project.displayName} project artwork`} width={160} height={160} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" onLoad={() => setLoaded(previous => [...previous, source])} onError={() => setFailed(previous => [...previous, source])} /> : <span className="rmtSrOnly">{label} · artwork unavailable</span>}
  </span>;
}
