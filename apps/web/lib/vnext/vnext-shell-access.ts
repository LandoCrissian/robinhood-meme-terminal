export type VNextShellEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  "NODE_ENV" | "VERCEL_ENV" | "NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED"
>>;

export function vnextShellAvailable(env: VNextShellEnvironment) {
  if (env.VERCEL_ENV === "production") return false;
  if (env.VERCEL_ENV === "preview") return true;
  if (env.NODE_ENV !== "production") return true;
  return env.NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED === "true";
}
