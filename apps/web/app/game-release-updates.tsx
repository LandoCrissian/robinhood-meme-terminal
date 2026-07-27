"use client";

import { useEffect, useState } from "react";
import { subscribeToGameUpdates } from "../lib/creator-application-cloud";
import { gameUpdateTime, type GameUpdate } from "../lib/game-updates";
import { ipfsToHttp } from "../lib/token-metadata";

const TYPE_LABELS: Record<GameUpdate["type"], string> = {
  development: "Development update",
  milestone: "Milestone",
  playtest: "Playtest",
  release: "Release"
};

function dateLabel(value: unknown) {
  const time = gameUpdateTime(value);
  return time
    ? new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(new Date(time))
    : "Just published";
}

export function GameReleaseUpdates({ projectSlug, projectName }: {
  projectSlug: string;
  projectName: string;
}) {
  const [updates, setUpdates] = useState<GameUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    setUnavailable(false);
    void subscribeToGameUpdates(projectSlug, (next) => {
      if (!active) return;
      setUpdates(next);
      setLoading(false);
    }, () => {
      if (!active) return;
      setUnavailable(true);
      setLoading(false);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (!active) return;
      setUnavailable(true);
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [projectSlug]);

  return <GameReleaseLogView
    projectName={projectName}
    updates={updates}
    loading={loading}
    unavailable={unavailable}
  />;
}

export function GameReleaseLogView({ projectName, updates, loading = false, unavailable = false }: {
  projectName: string;
  updates: GameUpdate[];
  loading?: boolean;
  unavailable?: boolean;
}) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  return (
    <section className="panel gameReleaseLog" aria-labelledby="game-release-log-title">
      <header>
        <div>
          <p className="eyebrow">CREATOR DEVELOPMENT LOG</p>
          <h2 id="game-release-log-title">Latest from {projectName}</h2>
          <p>Milestones, playtests and releases published by the verified page owner.</p>
        </div>
        <span>{updates.length} UPDATE{updates.length === 1 ? "" : "S"}</span>
      </header>
      {loading
        ? <div className="gameReleaseLogState">Loading creator updates…</div>
        : unavailable
          ? <div className="gameReleaseLogState">Development updates are temporarily unavailable.</div>
          : updates.length === 0
            ? <div className="gameReleaseLogState">The creator has not published a development update yet.</div>
            : <div className="gameReleaseLogList">
                {updates.map((update) => (
                  <article key={update.id}>
                    {update.imageUri && !failedImages.includes(update.imageUri) && (
                      <img
                        src={ipfsToHttp(update.imageUri)}
                        alt=""
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onError={() => setFailedImages((current) => [...current, update.imageUri])}
                      />
                    )}
                    <div>
                      <div className="gameReleaseLogMeta">
                        <span>{TYPE_LABELS[update.type]}</span>
                        {update.version && <span>{update.version}</span>}
                        <time>{dateLabel(update.createdAt)}</time>
                      </div>
                      <h3>{update.title}</h3>
                      <p>{update.body}</p>
                      {update.link && <a href={update.link} target="_blank" rel="noopener noreferrer">Open update link ↗</a>}
                    </div>
                  </article>
                ))}
              </div>}
      <small>Updates and external links are creator-authored. RMT page ownership verification is not an endorsement or software security review.</small>
    </section>
  );
}
