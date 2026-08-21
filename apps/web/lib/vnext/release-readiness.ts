import { vnextShellAvailable, vnextShellMode, type VNextShellEnvironment } from "./vnext-shell-access";
import {
  RMT_UNISWAP_V3_FEE_MAINNET_PROOF,
  RMT_UNISWAP_V3_FEE_MAINNET_PROOF_COMPLETE
} from "./uniswap-v3-fee-mainnet-proof";
import { acrossReviewedDeploymentPins } from "./across-funding-deployment";

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
  | "RMT_VNEXT_UP_V2_OBSERVATION_ENABLED"
  | "RMT_VNEXT_UP_CL_OBSERVATION_ENABLED"
  | "RMT_VNEXT_UP_V2_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_UP_CL_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED"
  | "RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS"
  | "RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH"
  | "RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET"
  | "RMT_VNEXT_EXECUTION_FEE_TREASURY"
  | "RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK"
  | "RMT_VNEXT_EXECUTION_FEE_POLICY_BEFORE_BLOCK"
  | "RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS"
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
  const acrossDeploymentPinsConfigured = Boolean(acrossReviewedDeploymentPins(env));
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
  const upV2ObservationEnabled = enabled(env.RMT_VNEXT_UP_V2_OBSERVATION_ENABLED);
  const upClObservationEnabled = enabled(env.RMT_VNEXT_UP_CL_OBSERVATION_ENABLED);
  const upV2AuthorizationEnabled = enabled(env.RMT_VNEXT_UP_V2_AUTHORIZATION_ENABLED);
  const upClAuthorizationEnabled = enabled(env.RMT_VNEXT_UP_CL_AUTHORIZATION_ENABLED);
  const feePolicyRequested = enabled(env.RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED);
  const uniswapFeeAuthorizationRequested = enabled(env.RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED);
  const uniswapFeePublicAuthorizationRequested = enabled(env.RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED);
  const feeProofWalletConfigured = /^0x[0-9a-fA-F]{40}$/.test(env.RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET?.trim() ?? "")
    && !/^0x0{40}$/i.test(env.RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET?.trim() ?? "");
  const feeExecutorConfigured = /^0x[0-9a-fA-F]{40}$/.test(env.RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS?.trim() ?? "")
    && /^0x[0-9a-fA-F]{64}$/.test(env.RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH?.trim() ?? "")
    && /^0x[0-9a-fA-F]{40}$/.test(env.RMT_VNEXT_EXECUTION_FEE_TREASURY?.trim() ?? "")
    && /^[1-9][0-9]*$/.test(env.RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK?.trim() ?? "")
    && (!env.RMT_VNEXT_EXECUTION_FEE_POLICY_BEFORE_BLOCK?.trim()
      || /^[1-9][0-9]*$/.test(env.RMT_VNEXT_EXECUTION_FEE_POLICY_BEFORE_BLOCK.trim()))
    && Boolean(env.RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS?.trim())
    && feeProofWalletConfigured;
  const configuredFeeAssetIds = new Set((env.RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS ?? "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const publicFeeProofBindingValid = feeExecutorConfigured
    && env.RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS?.trim().toLowerCase() === RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor.toLowerCase()
    && env.RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH?.trim().toLowerCase() === RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executorRuntimeHash
    && env.RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET?.trim().toLowerCase() === RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader.toLowerCase()
    && env.RMT_VNEXT_EXECUTION_FEE_TREASURY?.trim().toLowerCase() === RMT_UNISWAP_V3_FEE_MAINNET_PROOF.treasury.toLowerCase()
    && env.RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK?.trim() === "35041945"
    && !env.RMT_VNEXT_EXECUTION_FEE_POLICY_BEFORE_BLOCK?.trim()
    && configuredFeeAssetIds.size === 3
    && [
      "eip155:4663/contract:0x0bd7d308f8e1639fab988df18a8011f41eacad73",
      "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      "eip155:4663/native"
    ].every((assetId) => configuredFeeAssetIds.has(assetId));
  const acrossConfigurationValid = (!acrossQuotesRequested || acrossConfigured)
    && (!acrossAuthorizationRequested || (acrossConfigured && acrossQuotesRequested));
  const authorizationConsistent = authorizationClientEnabled === authorizationServerEnabled;
  const sushiConsistent = sushiClientEnabled === sushiServerEnabled;
  const walletSubmissionValid = !walletSubmissionEnabled || (authorizationClientEnabled && authorizationServerEnabled);
  const upAuthorizationValid = (!upV2AuthorizationEnabled || (upV2ObservationEnabled && authorizationClientEnabled && authorizationServerEnabled))
    && (!upClAuthorizationEnabled || (upClObservationEnabled && authorizationClientEnabled && authorizationServerEnabled));
  const feeAuthorizationValid = feePolicyRequested === uniswapFeeAuthorizationRequested
    && (!feePolicyRequested || (feeExecutorConfigured && authorizationClientEnabled && authorizationServerEnabled))
    && (!uniswapFeePublicAuthorizationRequested || (
      feePolicyRequested
      && uniswapFeeAuthorizationRequested
      && feeExecutorConfigured
      && publicFeeProofBindingValid
      && RMT_UNISWAP_V3_FEE_MAINNET_PROOF_COMPLETE
    ));
  const configurationConsistent = authorizationConsistent && sushiConsistent && walletSubmissionValid && acrossConfigurationValid && upAuthorizationValid && feeAuthorizationValid;

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
      upV2: {
        observationEnabled: upV2ObservationEnabled,
        strictVerificationAvailable: true,
        walletAuthorizationAvailable: true,
        authorizationEnabled: upV2AuthorizationEnabled && upV2ObservationEnabled && authorizationClientEnabled && authorizationServerEnabled,
        mainnetProofComplete: false
      },
      upCl: {
        observationEnabled: upClObservationEnabled,
        strictVerificationAvailable: true,
        walletAuthorizationAvailable: true,
        authorizationEnabled: upClAuthorizationEnabled && upClObservationEnabled && authorizationClientEnabled && authorizationServerEnabled,
        mainnetProofComplete: false
      },
      uniswapV3FeeExecutor: {
        policyEnabled: feePolicyRequested,
        configured: feeExecutorConfigured,
        proofWalletConfigured: feeProofWalletConfigured,
        releaseScope: feePolicyRequested && uniswapFeeAuthorizationRequested && feeExecutorConfigured
          ? uniswapFeePublicAuthorizationRequested
            ? publicFeeProofBindingValid
              ? "public" as const
              : "blocked" as const
            : "proof-wallet" as const
          : "disabled" as const,
        strictVerificationAvailable: true,
        walletAuthorizationAvailable: true,
        authorizationEnabled: feePolicyRequested && uniswapFeeAuthorizationRequested
          && feeExecutorConfigured && authorizationClientEnabled && authorizationServerEnabled,
        publicAuthorizationEnabled: feePolicyRequested && uniswapFeeAuthorizationRequested
          && uniswapFeePublicAuthorizationRequested && feeExecutorConfigured
          && publicFeeProofBindingValid && authorizationClientEnabled && authorizationServerEnabled,
        publicProofBindingValid: publicFeeProofBindingValid,
        deployedAndVerified: true,
        mainnetProofComplete: RMT_UNISWAP_V3_FEE_MAINNET_PROOF_COMPLETE
      },
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
