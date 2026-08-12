export type PublicLaunchRelease = Readonly<{
  status: "paused" | "open";
  reason: string;
}>;

// New creation is outside the current terminal roadmap. Environment variables
// cannot reopen the historical V6 form or establish a future launch policy.
export const publicLaunchRelease: PublicLaunchRelease = Object.freeze({
  status: "paused",
  reason: "New token creation is not part of RMT's current terminal roadmap."
});

export const publicRmtLaunchingEnabled =
  publicLaunchRelease.status === "open";
