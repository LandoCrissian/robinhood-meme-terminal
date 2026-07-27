export type PublicLaunchRelease = Readonly<{
  status: "paused" | "open";
  requiredProtocolVersion: number;
  reason: string;
}>;

// Fail closed until a dedicated V7 release proves the active factory,
// policies, routing, indexer support, and production configuration together.
// Environment variables cannot reopen the V6 form.
export const publicLaunchRelease: PublicLaunchRelease = Object.freeze({
  status: "paused",
  requiredProtocolVersion: 7,
  reason: "RMT V6 creation is closed while the V7 launch path is prepared."
});

export const publicRmtLaunchingEnabled =
  publicLaunchRelease.status === "open";
