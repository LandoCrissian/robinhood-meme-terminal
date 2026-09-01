import { vnextShellAvailable, vnextShellMode, type VNextShellEnvironment } from "./vnext-shell-access";
import {
  RMT_UNISWAP_V3_FEE_MAINNET_PROOF,
  RMT_UNISWAP_V3_FEE_MAINNET_PROOF_COMPLETE
} from "./uniswap-v3-fee-mainnet-proof";
import {
  RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE,
  RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE_VALID
} from "./uniswap-v3-v2-production-canary-evidence";
import { acrossReviewedDeploymentPins } from "./across-funding-deployment";
import {
  hasExactVNextV3V2PublicExecutionProviderScope,
  readVNextPublicExecutionProviderScope
} from "../server/vnext-public-execution-provider-scope";

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
  | "RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED"
  | "RMT_VNEXT_EXECUTION_V2_TREASURY"
  | "RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK"
  | "RMT_VNEXT_EXECUTION_V2_POLICY_HASH"
  | "RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED"
  | "RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ADDRESS"
  | "RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_RUNTIME_HASH"
  | "RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET"
  | "RMT_VNEXT_UNISWAP_V3_V2_PUBLIC_AUTHORIZATION_ENABLED"
  | "RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS"
  | "RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET"
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
  const v2PolicyRequested = enabled(env.RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED);
  const v2ExecutorRequested = enabled(env.RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED);
  const v2AuthorizationRequested = enabled(env.RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED);
  const v2PublicAuthorizationRequested = enabled(env.RMT_VNEXT_UNISWAP_V3_V2_PUBLIC_AUTHORIZATION_ENABLED);
  const publicExecutionProviderScope = readVNextPublicExecutionProviderScope(env);
  const exactV3V2PublicExecutionProviderScope = hasExactVNextV3V2PublicExecutionProviderScope(env);
  const publicV3AuthorizationRequested = uniswapFeePublicAuthorizationRequested || v2PublicAuthorizationRequested;
  const v2GateValuesValid = [
    env.RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED,
    env.RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED,
    env.RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED,
    env.RMT_VNEXT_UNISWAP_V3_V2_PUBLIC_AUTHORIZATION_ENABLED
  ].every((value) => value === undefined || value === "false" || value === "true");
  const v2ProofWalletConfigured = /^0x[0-9a-fA-F]{40}$/.test(env.RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET?.trim() ?? "")
    && !/^0x0{40}$/i.test(env.RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET?.trim() ?? "");
  const v2CommitmentSecretLength = env.RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET?.trim().length ?? 0;
  const v2CommitmentConfigured = v2CommitmentSecretLength >= 32 && v2CommitmentSecretLength <= 512;
  const v2PolicyConfigured = v2PolicyRequested
    && /^0x[0-9a-fA-F]{40}$/.test(env.RMT_VNEXT_EXECUTION_V2_TREASURY?.trim() ?? "")
    && /^[1-9][0-9]*$/.test(env.RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK?.trim() ?? "")
    && /^0x[0-9a-fA-F]{64}$/.test(env.RMT_VNEXT_EXECUTION_V2_POLICY_HASH?.trim() ?? "");
  const v2ExecutorConfigured = v2ExecutorRequested
    && /^0x[0-9a-fA-F]{40}$/.test(env.RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ADDRESS?.trim() ?? "")
    && /^0x[0-9a-fA-F]{64}$/.test(env.RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_RUNTIME_HASH?.trim() ?? "");
  const v2ExactAuthorityValid = v2PolicyConfigured && v2ExecutorConfigured
    && env.RMT_VNEXT_EXECUTION_V2_TREASURY?.trim().toLowerCase() === RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE.treasury.toLowerCase()
    && env.RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK?.trim() === "51296658"
    && env.RMT_VNEXT_EXECUTION_V2_POLICY_HASH?.trim().toLowerCase() === RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE.policyHash
    && env.RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ADDRESS?.trim().toLowerCase() === RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE.executor.toLowerCase()
    && env.RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_RUNTIME_HASH?.trim().toLowerCase() === RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE.executorRuntimeHash;
  const v2ReleaseAuthorityConfigured = v2ExactAuthorityValid && v2CommitmentConfigured
    && (v2PublicAuthorizationRequested || v2ProofWalletConfigured);
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
      && exactV3V2PublicExecutionProviderScope
    ));
  const v2AuthorizationValid = v2GateValuesValid
    && v2PolicyRequested === v2ExecutorRequested
    && v2ExecutorRequested === v2AuthorizationRequested
    && (!v2AuthorizationRequested || (
      v2ReleaseAuthorityConfigured
      && authorizationClientEnabled
      && authorizationServerEnabled
    ))
    && (!v2PublicAuthorizationRequested || (
      v2AuthorizationRequested
      && v2ExactAuthorityValid
      && v2CommitmentConfigured
      && RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE_VALID
      && exactV3V2PublicExecutionProviderScope
    ));
  const configurationConsistent = authorizationConsistent && sushiConsistent && walletSubmissionValid
    && publicExecutionProviderScope.valid
    && (!publicV3AuthorizationRequested || exactV3V2PublicExecutionProviderScope)
    && acrossConfigurationValid && upAuthorizationValid && feeAuthorizationValid && v2AuthorizationValid;

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
    publicExecution: {
      configured: publicExecutionProviderScope.configured,
      configurationValid: publicExecutionProviderScope.valid,
      providers: publicExecutionProviderScope.providers,
      exactV3V2ReleaseScope: exactV3V2PublicExecutionProviderScope,
      unintendedProviders: publicExecutionProviderScope.providers.filter((provider) => provider !== "uniswap-v3")
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
          && publicFeeProofBindingValid && exactV3V2PublicExecutionProviderScope
          && authorizationClientEnabled && authorizationServerEnabled,
        publicProofBindingValid: publicFeeProofBindingValid,
        deployedAndVerified: true,
        mainnetProofComplete: RMT_UNISWAP_V3_FEE_MAINNET_PROOF_COMPLETE
      },
      uniswapV3V2FeeExecutor: {
        policyEnabled: v2PolicyRequested,
        executorEnabled: v2ExecutorRequested,
        configured: v2ExactAuthorityValid,
        proofWalletConfigured: v2ProofWalletConfigured,
        commitmentConfigured: v2CommitmentConfigured,
        releaseScope: v2PolicyRequested && v2ExecutorRequested && v2AuthorizationRequested
          ? v2PublicAuthorizationRequested
            ? v2ExactAuthorityValid && v2CommitmentConfigured
              ? "public" as const
              : "blocked" as const
            : v2ExactAuthorityValid && v2CommitmentConfigured && v2ProofWalletConfigured
              ? "proof-wallet" as const
              : "blocked" as const
          : "disabled" as const,
        strictVerificationAvailable: true,
        walletAuthorizationAvailable: true,
        authorizationEnabled: v2AuthorizationRequested && v2ReleaseAuthorityConfigured
          && authorizationClientEnabled && authorizationServerEnabled,
        publicAuthorizationEnabled: v2PublicAuthorizationRequested && v2AuthorizationRequested
          && v2ExactAuthorityValid && v2CommitmentConfigured
          && exactV3V2PublicExecutionProviderScope
          && authorizationClientEnabled && authorizationServerEnabled,
        exactAuthorityValid: v2ExactAuthorityValid,
        nativeInputMainnetCanaryComplete: RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE_VALID,
        erc20ToNativeLiveCanary: "OWNER_WAIVED_NOT_EXECUTED" as const,
        bidirectionalLiveProof: false
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
