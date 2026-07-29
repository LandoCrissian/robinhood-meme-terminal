import type { LaunchFeedItem } from "./launch-feed";
import { OFFICIAL_RMT_V6_TOKEN } from "./project-page";

/**
 * V7 release boundary:
 * keep historical records intact while exposing only RMT's official project
 * through public RMT-native discovery. This is intentionally code-controlled
 * so a client-side environment variable cannot accidentally republish an
 * inactive V6 project.
 */
export const publicRmtProjectVisibility = "official-only" as const;
export const publicCommunityProjectPagesEnabled: boolean = false;

export function isPublicRmtNativeLaunch(launch: Pick<LaunchFeedItem, "token">) {
  return launch.token.toLowerCase() === OFFICIAL_RMT_V6_TOKEN.toLowerCase();
}

export function publicRmtNativeLaunches(launches: LaunchFeedItem[]) {
  return launches.filter(isPublicRmtNativeLaunch);
}
