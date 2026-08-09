import { vnextShellAvailable, vnextShellMode, type VNextShellEnvironment } from "./vnext-shell-access";

export type VNextReleaseEnvironment = VNextShellEnvironment & Partial<Pick<
  NodeJS.ProcessEnv,
  | "NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_AUTHORIZATION_ENABLED"
  | "NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED"
  | "NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED"
  | "RMT_SUSHI_QUOTES_ENABLED"
>>;

export type VNextReleaseMode = "disabled" | "observation" | "wallet-review" | "interactive" | "misconfigured";

function enabled(value: string | undefined) {
  return value === "true";
}

export function readVNextReleaseReadiness(env: VNextReleaseEnvironment) {
  const shellMode = vnextShellMode(env);
  const shellEnabled = vnextShellAvailable(env);
  const authorizationClientEnabled = enabled(env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED);
  const authorizationServerEnabled = enabled(env.RMT_VNEXT_AUTHORIZATION_ENABLED);
  const walletSubmissionEnabled = enabled(env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED);
  const sushiClientEnabled = enabled(env.NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED);
  const sushiServerEnabled = enabled(env.RMT_SUSHI_QUOTES_ENABLED);
  const authorizationConsistent = authorizationClientEnabled === authorizationServerEnabled;
  const sushiConsistent = sushiClientEnabled === sushiServerEnabled;
  const walletSubmissionValid = !walletSubmissionEnabled || (authorizationClientEnabled && authorizationServerEnabled);
  const configurationConsistent = authorizationConsistent && sushiConsistent && walletSubmissionValid;

  let mode: VNextReleaseMode = "disabled";
  if (shellEnabled && !configurationConsistent) mode = "misconfigured";
  else if (shellEnabled && walletSubmissionEnabled) mode = "interactive";
  else if (shellEnabled && authorizationClientEnabled && authorizationServerEnabled) mode = "wallet-review";
  else if (shellEnabled) mode = "observation";

  return {
    mode,
    shellMode,
    shellEnabled,
    configurationConsistent,
    productionObservationReady: shellMode === "production-observe" && mode === "observation",
    execution: {
      authorizationClientEnabled,
      authorizationServerEnabled,
      walletSubmissionEnabled
    },
    providers: {
      sushiClientEnabled,
      sushiServerEnabled
    }
  } as const;
}
