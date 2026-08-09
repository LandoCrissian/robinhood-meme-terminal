export type VNextShellEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  "NODE_ENV" | "VERCEL_ENV" | "RMT_VNEXT_SHELL_ENABLED"
>>;

export type VNextShellMode = "unavailable" | "development" | "preview" | "production-observe";

export function vnextShellMode(env: VNextShellEnvironment): VNextShellMode {
  if (env.VERCEL_ENV === "preview") return "preview";
  if (env.NODE_ENV !== "production") return "development";
  if (env.RMT_VNEXT_SHELL_ENABLED === "true") return "production-observe";
  return "unavailable";
}

export function vnextShellAvailable(env: VNextShellEnvironment) {
  return vnextShellMode(env) !== "unavailable";
}
