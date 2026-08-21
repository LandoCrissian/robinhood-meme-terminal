import assert from "node:assert/strict";
import { getAddress, type Hex } from "viem";
import {
  ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA,
  AcrossInfrastructurePreflightError,
  acrossInfrastructurePreflightFailure,
  assertSanitizedAcrossInfrastructurePreflightResult,
  classifyFirebaseAdminFailure,
  runAcrossInfrastructurePreflight,
  verifyAcrossInfrastructureDeploymentEvidence,
  type AcrossInfrastructurePreflightFailureClassification,
  type FirebaseAdminFailureDiagnostic,
  type AcrossInfrastructureRpcObservation
} from "./vnext-across-infrastructure-preflight";
import { ACROSS_FUNDING_DEPLOYMENT_V1 } from "../vnext/across-funding-deployment";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID,
  TRUSTED_ASSET_ADDRESSES
} from "../vnext/trusted-asset-registry";

const API_KEY_FIXTURE = ["synthetic", "across", "api", "key", "fixture"].join("-");
const RPC_TOKEN_FIXTURE = ["synthetic", "rpc", "auth", "token", "fixture"].join("-");
const FIREBASE_KEY_FIXTURE = [
  "-----BEGIN ",
  "PRIVATE KEY-----\n",
  ["synthetic", "firebase", "private", "key", "fixture"].join("-"),
  "\n-----END ",
  "PRIVATE KEY-----"
].join("");
const PREFLIGHT_TOKEN_FIXTURE = ["synthetic", "preflight", "bearer", "token", "fixture", "0123456789abcdef"].join("-");
const secretFixtures = [API_KEY_FIXTURE, RPC_TOKEN_FIXTURE, FIREBASE_KEY_FIXTURE, PREFLIGHT_TOKEN_FIXTURE];
const chainIds = [
  ETHEREUM_MAINNET_CHAIN_ID,
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID
] as const;

const deploymentEnvironment = Object.fromEntries(chainIds.flatMap((chainId) => {
  const prefix = chainId === 1 ? "ETHEREUM" : chainId === 42161 ? "ARBITRUM" : chainId === 8453 ? "BASE" : "ROBINHOOD";
  const admission = ACROSS_FUNDING_DEPLOYMENT_V1[chainId];
  return [
    [`RMT_ACROSS_${prefix}_SPOKE_POOL_PROXY_CODE_HASH`, admission.proxyRuntimeHash],
    [`RMT_ACROSS_${prefix}_SPOKE_POOL_IMPLEMENTATION_ADDRESS`, admission.implementationAddress],
    [`RMT_ACROSS_${prefix}_SPOKE_POOL_IMPLEMENTATION_CODE_HASH`, admission.implementationRuntimeHash]
  ];
}));

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ...deploymentEnvironment,
  RMT_ACROSS_API_KEY: API_KEY_FIXTURE,
  RMT_ACROSS_INTEGRATOR_ID: "0x1234",
  RMT_ETHEREUM_RPC_URL: "https://rpc.example/ethereum",
  RMT_ETHEREUM_RPC_AUTH_TOKEN: RPC_TOKEN_FIXTURE,
  RMT_ARBITRUM_RPC_URL: "https://rpc.example/arbitrum",
  RMT_ARBITRUM_RPC_AUTH_TOKEN: RPC_TOKEN_FIXTURE,
  RMT_BASE_RPC_URL: "https://rpc.example/base",
  RMT_BASE_RPC_AUTH_TOKEN: RPC_TOKEN_FIXTURE,
  RMT_ACROSS_ROBINHOOD_RPC_URL: "https://rpc.example/robinhood",
  RMT_ACROSS_ROBINHOOD_RPC_AUTH_TOKEN: RPC_TOKEN_FIXTURE,
  FIREBASE_ADMIN_PROJECT_ID: "rmt-test-project",
  FIREBASE_ADMIN_CLIENT_EMAIL: "preflight@rmt-test-project.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: FIREBASE_KEY_FIXTURE,
  RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_TOKEN: PREFLIGHT_TOKEN_FIXTURE,
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  VERCEL_DEPLOYMENT_ID: "dpl_synthetic"
};

const chainsResponse = chainIds.map((chainId) => ({
  chainId,
  name: ACROSS_FUNDING_DEPLOYMENT_V1[chainId].chainName
}));
const tokensResponse = [
  { chainId: 1, address: TRUSTED_ASSET_ADDRESSES.ETHEREUM_USDC, decimals: 6 },
  { chainId: 42161, address: TRUSTED_ASSET_ADDRESSES.ARBITRUM_USDC, decimals: 6 },
  { chainId: 8453, address: TRUSTED_ASSET_ADDRESSES.BASE_USDC, decimals: 6 },
  { chainId: 4663, address: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG, decimals: 6 }
];

function releaseFetch(input: string | URL | Request) {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const body = url.pathname.endsWith("/chains") ? chainsResponse : tokensResponse;
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
}

function observation(chainId: typeof chainIds[number]) {
  const admission = ACROSS_FUNDING_DEPLOYMENT_V1[chainId];
  return {
    proxyRuntimeHash: admission.proxyRuntimeHash,
    implementationAddress: admission.implementationAddress,
    implementationRuntimeHash: admission.implementationRuntimeHash,
    observedBlockNumber: (BigInt(admission.evidenceBlock) + 100n).toString(),
    observedBlockHash: `0x${chainId.toString(16).padStart(64, "0")}` as Hex,
    pinnedBlockHashRereadVerified: true as const
  };
}

function dependencies(input: {
  failChain?: number;
  failCause?: unknown;
  firebaseFailure?: unknown;
} = {}) {
  return {
    observeDeployment: async ({ chain }: { chain: { chainId: typeof chainIds[number] } }) => {
      if (input.failChain === chain.chainId) throw input.failCause ?? new Error("wrong chain identity");
      return observation(chain.chainId);
    },
    firebaseAdminRead: async () => {
      if (Object.prototype.hasOwnProperty.call(input, "firebaseFailure")) throw input.firebaseFailure;
    }
  };
}

async function expectFailure(
  run: () => Promise<unknown>,
  classification: AcrossInfrastructurePreflightFailureClassification
) {
  await assert.rejects(run, (cause: unknown) => {
    assert.ok(cause instanceof AcrossInfrastructurePreflightError);
    assert.equal(cause.classification, classification);
    assert.doesNotMatch(cause.message, /synthetic|authorization|privateKey|apiKey|authToken/i);
    return true;
  });
}

async function expectFirebaseFailure(
  cause: unknown,
  diagnostic: FirebaseAdminFailureDiagnostic
) {
  let captured: AcrossInfrastructurePreflightError | undefined;
  await assert.rejects(() => runAcrossInfrastructurePreflight({
    env,
    fetchImplementation: releaseFetch,
    dependencies: dependencies({ firebaseFailure: cause })
  }), (error: unknown) => {
    assert.ok(error instanceof AcrossInfrastructurePreflightError);
    assert.equal(error.classification, "FIREBASE_ADMIN_READ");
    assert.equal(error.firebaseAdminFailure, diagnostic);
    captured = error;
    return true;
  });
  assert.ok(captured);
  const failure = acrossInfrastructurePreflightFailure(captured, secretFixtures);
  assert.equal(failure.classification, "FIREBASE_ADMIN_READ");
  assert.equal(failure.firebaseAdminFailure, diagnostic);
  assert.equal(failure.sanitizedMessage, "Firebase Admin read-only connectivity could not be verified.");
  return failure;
}

async function main() {
const requestedPaths: string[] = [];
const success = await runAcrossInfrastructurePreflight({
  env,
  observedAtMs: 1_700_000_000_000,
  fetchImplementation: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requestedPaths.push(url.pathname);
    assert.equal(url.searchParams.get("integratorId"), "0x1234");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${API_KEY_FIXTURE}`);
    return releaseFetch(input);
  },
  dependencies: dependencies()
});
assert.equal(success.schemaVersion, ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA);
assert.equal(success.status, "across_infrastructure_preflight_passed");
assert.deepEqual(requestedPaths.sort(), ["/api/swap/chains", "/api/swap/tokens"]);
assert.equal(success.authenticatedApiVerified, true);
assert.equal(success.robinhoodChainSupported, true);
assert.equal(success.persistence.firebaseAdminReadVerified, true);
assert.equal(success.rpcObservations.length, 4);
assert.deepEqual(success.rpcObservations.map((item) => item.chainId), [...chainIds]);
assert.ok(success.rpcObservations.every((item) => item.rpcIdentityVerified && item.pinnedBlockHashRereadVerified));
assert.equal(success.walletUsed, false);
assert.equal(success.quoteRequested, false);
assert.equal(success.approvalRequested, false);
assert.equal(success.transactionAttempted, false);
assert.equal(success.serverSubmissionEnabled, false);

const serializedSuccess = JSON.stringify(success);
for (const secret of secretFixtures) assert.equal(serializedSuccess.includes(secret), false);
assertSanitizedAcrossInfrastructurePreflightResult(success, secretFixtures);
const sanitizedFailure = acrossInfrastructurePreflightFailure(new Error(API_KEY_FIXTURE), secretFixtures);
const serializedFailure = JSON.stringify(sanitizedFailure);
for (const secret of secretFixtures) assert.equal(serializedFailure.includes(secret), false);
assert.doesNotMatch(serializedFailure, /authorization\s*(?:header|:)|process\.env|privateKey|apiKey|authToken/i);
assert.throws(() => assertSanitizedAcrossInfrastructurePreflightResult({
  ...sanitizedFailure,
  apiKey: API_KEY_FIXTURE
} as typeof sanitizedFailure, secretFixtures), /internal details/);

await expectFailure(() => runAcrossInfrastructurePreflight({
  env,
  fetchImplementation: async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return new Response(JSON.stringify(url.pathname.endsWith("/chains") ? {} : tokensResponse));
  },
  dependencies: dependencies()
}), "ACROSS_RELEASE_DISCOVERY");

await expectFailure(() => runAcrossInfrastructurePreflight({
  env,
  fetchImplementation: async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return new Response(JSON.stringify(url.pathname.endsWith("/chains") ? chainsResponse : {}));
  },
  dependencies: dependencies()
}), "ACROSS_RELEASE_DISCOVERY");

await expectFailure(() => runAcrossInfrastructurePreflight({
  env,
  fetchImplementation: async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return new Response(JSON.stringify(url.pathname.endsWith("/chains")
      ? chainsResponse.filter((chain) => chain.chainId !== 4663)
      : tokensResponse));
  },
  dependencies: dependencies()
}), "ACROSS_RELEASE_DISCOVERY");

for (const counterfeit of [1, 42161, 8453, 4663]) {
  await expectFailure(() => runAcrossInfrastructurePreflight({
    env,
    fetchImplementation: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      return new Response(JSON.stringify(url.pathname.endsWith("/chains") ? chainsResponse : tokensResponse.map((token) =>
        token.chainId === counterfeit ? { ...token, address: getAddress("0x1111111111111111111111111111111111111111") } : token)));
    },
    dependencies: dependencies()
  }), "ACROSS_RELEASE_DISCOVERY");
}

const rpcClassifications = ["ETHEREUM_RPC", "ARBITRUM_RPC", "BASE_RPC", "ROBINHOOD_RPC"] as const;
for (let index = 0; index < chainIds.length; index += 1) {
  await expectFailure(() => runAcrossInfrastructurePreflight({
    env,
    fetchImplementation: releaseFetch,
    dependencies: dependencies({ failChain: chainIds[index] })
  }), rpcClassifications[index]);
}

const expected = {
  proxyRuntimeHash: ACROSS_FUNDING_DEPLOYMENT_V1[1].proxyRuntimeHash,
  implementationAddress: ACROSS_FUNDING_DEPLOYMENT_V1[1].implementationAddress,
  implementationRuntimeHash: ACROSS_FUNDING_DEPLOYMENT_V1[1].implementationRuntimeHash
};
assert.throws(() => verifyAcrossInfrastructureDeploymentEvidence({
  expected,
  observed: { ...expected, proxyRuntimeHash: `0x${"1".repeat(64)}` }
}), (cause: unknown) => cause instanceof AcrossInfrastructurePreflightError && cause.classification === "PROXY_RUNTIME_MISMATCH");
assert.throws(() => verifyAcrossInfrastructureDeploymentEvidence({
  expected,
  observed: { ...expected, implementationAddress: getAddress("0x1111111111111111111111111111111111111111") }
}), (cause: unknown) => cause instanceof AcrossInfrastructurePreflightError && cause.classification === "IMPLEMENTATION_MISMATCH");
assert.throws(() => verifyAcrossInfrastructureDeploymentEvidence({
  expected,
  observed: { ...expected, implementationRuntimeHash: `0x${"2".repeat(64)}` }
}), (cause: unknown) => cause instanceof AcrossInfrastructurePreflightError && cause.classification === "IMPLEMENTATION_MISMATCH");

await expectFailure(() => runAcrossInfrastructurePreflight({
  env,
  fetchImplementation: releaseFetch,
  dependencies: dependencies({
    failChain: 1,
    failCause: new Error("RMT rejected replaced Across deployment evidence.")
  })
}), "PINNED_BLOCK_REPLACEMENT");
const firebaseVectors: readonly [unknown, FirebaseAdminFailureDiagnostic][] = [
  [{ code: 7 }, "PERMISSION_DENIED"],
  [{ code: 16 }, "UNAUTHENTICATED"],
  [{ code: 5 }, "NOT_FOUND"],
  [{ code: 9 }, "FAILED_PRECONDITION"],
  [{ code: 14 }, "UNAVAILABLE"],
  [{ code: 4 }, "DEADLINE_EXCEEDED"],
  [{ code: 8 }, "RESOURCE_EXHAUSTED"],
  [{ errorInfo: { code: "app/invalid-credential" } }, "INVALID_CREDENTIAL"],
  [{ errorInfo: { code: "app/invalid-app-argument" } }, "INVALID_ARGUMENT"],
  [{ code: 99 }, "UNKNOWN"],
  [{ code: "unknown/structured-code" }, "UNKNOWN"],
  [new Error(`credential-looking text must remain opaque: ${FIREBASE_KEY_FIXTURE}`), "UNKNOWN"]
];
for (const [cause, diagnostic] of firebaseVectors) {
  assert.equal(classifyFirebaseAdminFailure(cause), diagnostic);
  await expectFirebaseFailure(cause, diagnostic);
}

const secretBearingFirebaseCause = {
  code: 7,
  message: `Authorization: Bearer ${PREFLIGHT_TOKEN_FIXTURE}`,
  stack: `synthetic stack ${API_KEY_FIXTURE}`,
  details: { privateKey: FIREBASE_KEY_FIXTURE },
  metadata: { authToken: RPC_TOKEN_FIXTURE },
  nested: { apiKey: API_KEY_FIXTURE, process: "process.env" }
};
const secretBearingFirebaseFailure = await expectFirebaseFailure(
  secretBearingFirebaseCause,
  "PERMISSION_DENIED"
);
const serializedFirebaseFailure = JSON.stringify(secretBearingFirebaseFailure);
for (const secret of secretFixtures) assert.equal(serializedFirebaseFailure.includes(secret), false);
assert.doesNotMatch(
  serializedFirebaseFailure,
  /Authorization:|process\.env|privateKey|apiKey|authToken|details|metadata|nested|synthetic stack/i
);
await expectFailure(() => runAcrossInfrastructurePreflight({
  env,
  fetchImplementation: async () => {
    throw new DOMException("synthetic timeout", "TimeoutError");
  },
  dependencies: dependencies()
}), "NETWORK_TIMEOUT");
await expectFailure(() => runAcrossInfrastructurePreflight({
  env,
  fetchImplementation: async () => new Response(null, { status: 401 }),
  dependencies: dependencies()
}), "ACROSS_API_AUTH");
await expectFailure(() => runAcrossInfrastructurePreflight({
  env: { ...env, RMT_ACROSS_API_KEY: undefined },
  fetchImplementation: releaseFetch,
  dependencies: dependencies()
}), "CONFIGURATION");

const publicObservation = success.rpcObservations[0] as AcrossInfrastructureRpcObservation;
assert.match(publicObservation.observedBlockNumber, /^[1-9][0-9]*$/);
assert.match(publicObservation.observedBlockHash, /^0x[0-9a-f]{64}$/i);

console.log("RMT Across production-runtime infrastructure preflight checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
