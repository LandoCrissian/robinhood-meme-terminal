import { vnextShellAvailable, vnextShellMode, type VNextShellEnvironment } from "./vnext-shell-access";

export type VNextReleaseEnvironment = VNextShellEnvironment & Partial<Pick<
  NodeJS.ProcessEnv,
  | "NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_AUTHORIZATION_ENABLED"
  | "NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED"
  | "NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED"
  | "RMT_SUSHI_QUOTES_ENABLED"
  | "RMT_ACROSS_API_KEY"
  | "RMT_ACROSS_INTEGRATOR_ID"
  | "RMT_ACROSS_ETHEREUM_SPOKE_POOL_PROXY_CODE_HASH"
  | "RMT_ACROSS_ETHEREUM_SPOKE_POOL_IMPLEMENTATION_ADDRESS"
  | "RMT_ACROSS_ETHEREUM_SPOKE_POOL_IMPLEMENTATION_CODE_HASH"
  | "RMT_ACROSS_ARBITRUM_SPOKE_POOL_PROXY_CODE_HASH"
  | "RMT_ACROSS_ARBITRUM_SPOKE_POOL_IMPLEMENTATION_ADDRESS"
  | "RMT_ACROSS_ARBITRUM_SPOKE_POOL_IMPLEMENTATION_CODE_HASH"
  | "RMT_ACROSS_BASE_SPOKE_POOL_PROXY_CODE_HASH"
  | "RMT_ACROSS_BASE_SPOKE_POOL_IMPLEMENTATION_ADDRESS"
  | "RMT_ACROSS_BASE_SPOKE_POOL_IMPLEMENTATION_CODE_HASH"
  | "RMT_ACROSS_ROBINHOOD_SPOKE_POOL_PROXY_CODE_HASH"
  | "RMT_ACROSS_ROBINHOOD_SPOKE_POOL_IMPLEMENTATION_ADDRESS"
  | "RMT_ACROSS_ROBINHOOD_SPOKE_POOL_IMPLEMENTATION_CODE_HASH"
  | "RMT_VNEXT_ACROSS_FUNDING_QUOTES_ENABLED"
  | "RMT_VNEXT_ACROSS_FUNDING_AUTHORIZATION_ENABLED"
  | "RMT_ETHEREUM_RPC_URL"
  | "RMT_ETHEREUM_RPC_AUTH_TOKEN"
  | "RMT_ARBITRUM_RPC_URL"
  | "RMT_ARBITRUM_RPC_AUTH_TOKEN"
  | "RMT_BASE_RPC_URL"
  | "RMT_BASE_RPC_AUTH_TOKEN"
  | "RMT_ACROSS_ROBINHOOD_RPC_URL"
  | "RMT_ACROSS_ROBINHOOD_RPC_AUTH_TOKEN"
  | "FIREBASE_ADMIN_PROJECT_ID"
  | "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  | "FIREBASE_ADMIN_CLIENT_EMAIL"
  | "FIREBASE_ADMIN_PRIVATE_KEY"
>>;

export type VNextReleaseMode = "disabled" | "observation" | "wallet-review" | "interactive" | "misconfigured";

function enabled(value: string | undefined) {
  return value === "true";
}

function httpsEndpoint(value: string | undefined) {
  try {
    return new URL(value?.trim() ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

function firebaseAdminConfigured(env: VNextReleaseEnvironment) {
  const projectId = (env.FIREBASE_ADMIN_PROJECT_ID ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim();
  const clientEmail = (env.FIREBASE_ADMIN_CLIENT_EMAIL ?? "").trim();
  const privateKey = (env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replaceAll("\\n", "\n").trim();
  return /^[a-z0-9-]{4,64}$/.test(projectId)
    && clientEmail.endsWith(".gserviceaccount.com")
    && privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
    && privateKey.endsWith("-----END PRIVATE KEY-----");
}

export function readVNextReleaseReadiness(env: VNextReleaseEnvironment) {
  const shellMode = vnextShellMode(env);
  const shellEnabled = vnextShellAvailable(env);
  const authorizationClientEnabled = enabled(env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED);
  const authorizationServerEnabled = enabled(env.RMT_VNEXT_AUTHORIZATION_ENABLED);
  const walletSubmissionEnabled = enabled(env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED);
  const sushiClientEnabled = enabled(env.NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED);
  const sushiServerEnabled = enabled(env.RMT_SUSHI_QUOTES_ENABLED);
  const acrossCredentialsConfigured = Boolean(env.RMT_ACROSS_API_KEY?.trim())
    && /^0x[0-9a-fA-F]{4}$/.test(env.RMT_ACROSS_INTEGRATOR_ID?.trim() ?? "");
  const acrossDeploymentPinsConfigured = ["ETHEREUM", "ARBITRUM", "BASE", "ROBINHOOD"].every((chain) => {
      const values = env as Record<string, string | undefined>;
      return /^0x[0-9a-fA-F]{64}$/.test(values[`RMT_ACROSS_${chain}_SPOKE_POOL_PROXY_CODE_HASH`]?.trim() ?? "")
        && /^0x[0-9a-fA-F]{40}$/.test(values[`RMT_ACROSS_${chain}_SPOKE_POOL_IMPLEMENTATION_ADDRESS`]?.trim() ?? "")
        && /^0x[0-9a-fA-F]{64}$/.test(values[`RMT_ACROSS_${chain}_SPOKE_POOL_IMPLEMENTATION_CODE_HASH`]?.trim() ?? "");
    });
  const acrossRpcConfigured = [
    [env.RMT_ETHEREUM_RPC_URL, env.RMT_ETHEREUM_RPC_AUTH_TOKEN],
    [env.RMT_ARBITRUM_RPC_URL, env.RMT_ARBITRUM_RPC_AUTH_TOKEN],
    [env.RMT_BASE_RPC_URL, env.RMT_BASE_RPC_AUTH_TOKEN],
    [env.RMT_ACROSS_ROBINHOOD_RPC_URL, env.RMT_ACROSS_ROBINHOOD_RPC_AUTH_TOKEN]
  ].every(([endpoint, token]) => httpsEndpoint(endpoint) && Boolean(token?.trim()));
  const acrossPersistenceConfigured = firebaseAdminConfigured(env);
  const acrossConfigured = acrossCredentialsConfigured
    && acrossDeploymentPinsConfigured
    && acrossRpcConfigured
    && acrossPersistenceConfigured;
  const acrossQuotesRequested = enabled(env.RMT_VNEXT_ACROSS_FUNDING_QUOTES_ENABLED);
  const acrossAuthorizationRequested = enabled(env.RMT_VNEXT_ACROSS_FUNDING_AUTHORIZATION_ENABLED);
  const acrossConfigurationValid = (!acrossQuotesRequested || acrossConfigured)
    && (!acrossAuthorizationRequested || (acrossConfigured && acrossQuotesRequested));
  const authorizationConsistent = authorizationClientEnabled === authorizationServerEnabled;
  const sushiConsistent = sushiClientEnabled === sushiServerEnabled;
  const walletSubmissionValid = !walletSubmissionEnabled || (authorizationClientEnabled && authorizationServerEnabled);
  const configurationConsistent = authorizationConsistent && sushiConsistent && walletSubmissionValid && acrossConfigurationValid;

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
      sushiServerEnabled,
      acrossFunding: {
        configured: acrossConfigured,
        credentialsConfigured: acrossCredentialsConfigured,
        deploymentPinsConfigured: acrossDeploymentPinsConfigured,
        rpcConfigured: acrossRpcConfigured,
        persistenceConfigured: acrossPersistenceConfigured,
        quotesEnabled: acrossConfigured && acrossQuotesRequested,
        authorizationEnabled: acrossConfigured && acrossQuotesRequested && acrossAuthorizationRequested,
        trackingEnabled: Boolean(env.RMT_ACROSS_API_KEY?.trim()) && acrossRpcConfigured && acrossPersistenceConfigured,
        publicAssetSelectionEnabled: false,
        mainnetProofComplete: false
      }
    }
  } as const;
}
