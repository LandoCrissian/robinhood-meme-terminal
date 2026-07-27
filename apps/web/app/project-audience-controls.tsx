"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  setProjectFollow,
  subscribeToProjectFollow,
  subscribeToProjectFollowerCount
} from "../lib/project-follows";
import { useProfile } from "./profile-provider";

export function ProjectAudienceControls({ projectSlug }: { projectSlug: string }) {
  const { loading: profileLoading, user } = useProfile();
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  const [followChecked, setFollowChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToProjectFollowerCount(projectSlug, (count) => {
      if (active) setFollowerCount(count);
    }, () => {
      if (active) setFollowerCount(null);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setFollowerCount(null);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [projectSlug]);

  useEffect(() => {
    setFollowing(false);
    setFollowChecked(false);
    setMessage("");
    if (!user) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToProjectFollow(user, projectSlug, (next) => {
      if (!active) return;
      setFollowing(next);
      setFollowChecked(true);
    }, () => {
      if (active) setFollowChecked(true);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setFollowChecked(true);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [projectSlug, user]);

  const toggleFollow = async () => {
    if (!user || busy) return;
    const next = !following;
    setBusy(true);
    setMessage("");
    try {
      await setProjectFollow(user, projectSlug, next);
      setMessage(next ? "Following this project privately." : "Project removed from your followed pages.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The follow could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  return <ProjectAudienceView
    followerCount={followerCount}
    profileLoading={profileLoading}
    userPresent={Boolean(user)}
    following={following}
    followChecked={followChecked}
    busy={busy}
    message={message}
    onToggle={() => void toggleFollow()}
  />;
}

export function ProjectAudienceView({
  followerCount,
  profileLoading,
  userPresent,
  following,
  followChecked,
  busy,
  message,
  onToggle
}: {
  followerCount: number | null;
  profileLoading: boolean;
  userPresent: boolean;
  following: boolean;
  followChecked: boolean;
  busy: boolean;
  message: string;
  onToggle: () => void;
}) {
  const countLabel = followerCount === null
    ? "Audience syncing"
    : `${followerCount.toLocaleString()} ${followerCount === 1 ? "person watching" : "people watching"}`;
  return (
    <div className="projectAudienceControls">
      <div aria-label={countLabel}>
        <strong>{followerCount === null ? "—" : followerCount.toLocaleString()}</strong>
        <span>{followerCount === 1 ? "PERSON WATCHING" : "PEOPLE WATCHING"}</span>
      </div>
      {!profileLoading && (
        userPresent
          ? <button
              type="button"
              aria-pressed={following}
              disabled={!followChecked || busy}
              onClick={onToggle}
            >
              {busy ? "Updating…" : following ? "Following ✓" : "Follow project"}
            </button>
          : <Link href="/profile">Sign in to follow</Link>
      )}
      {message && <small role="status">{message}</small>}
      <p>Follower identities stay private. Only the aggregate count is public.</p>
    </div>
  );
}
