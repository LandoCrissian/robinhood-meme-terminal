import type { LaunchFeedItem } from "./launch-feed";
/**
 * The launchpad is retired. Historical records remain available through their
 * direct onchain provenance, but none is promoted as a current RMT project.
 */
export const publicRmtProjectVisibility = "retired" as const;
export const publicCommunityProjectPagesEnabled: boolean = false;

export function isPublicRmtNativeLaunch(_launch: Pick<LaunchFeedItem, "token">) {
  return false;
}

export function publicRmtNativeLaunches(launches: LaunchFeedItem[]) {
  return launches.filter(isPublicRmtNativeLaunch);
}
