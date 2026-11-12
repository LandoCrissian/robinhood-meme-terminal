import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keccak256, toHex, type PublicClient } from "viem";
import deploymentIdentities from "../../../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";
import { readBrowserLaunchpadDeployment, readLaunchpadRuntime, verifiedGrowthVaultDeployer } from "./new-launchpad-config";

const address = (value: number) => toHex(value, { size: 20 });
const hash = (value: number) => toHex(value, { size: 32 });
const factory = address(1);
const growthRegistry = address(2);
const reviewers = ["0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"];
const code = "0x1234";
const base = {
  RMT_LAUNCHPAD_ENABLED: "true",
  RMT_LAUNCHPAD_CHAIN_ID: "31337",
  RMT_LAUNCHPAD_ENGINE_VERSION: "2",
  RMT_LAUNCHPAD_FACTORY_ADDRESS: factory,
  RMT_LAUNCHPAD_FACTORY_RUNTIME_HASH: keccak256(code),
  RMT_LAUNCHPAD_FACTORY_START_BLOCK: "57648301",
  RMT_LAUNCHPAD_GUARD_ADDRESS: address(0x2000),
  RMT_LAUNCHPAD_GUARD_RUNTIME_HASH: keccak256(code),
  RMT_LAUNCHPAD_DATABASE_PATH: join(tmpdir(), "unused-growth-config.sqlite"),
  RMT_LAUNCHPAD_RPC_URL: "http://127.0.0.1:8545",
};
const pins = { RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_ADDRESS: growthRegistry,
  RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_RUNTIME_HASH: keccak256(code) };
const enabled = { ...base, ...pins, RMT_LAUNCHPAD_GROWTH_VAULT_TEST_FIXTURE: "true" };
const config = readLaunchpadRuntime(enabled)!;
const fork = deploymentIdentities.baseSepolia;
const head = BigInt(fork.block) + 10n;

function mockRpc({ accounts = [address(3), ...reviewers], registryFactory = factory, registryCode = code,
  approvedReviewers = reviewers, anchorHash = fork.blockHash, latestHash = hash(40), canonicalHeadHash = hash(40),
  chainId = 31337, rpcUnavailable = false } = {}): PublicClient {
  return {
    async getChainId() { return chainId; },
    async getBlock({ blockNumber }: { blockNumber?: bigint }) {
      if (blockNumber === BigInt(fork.block)) return { number: blockNumber, hash: anchorHash };
      return { number: head, hash: blockNumber === undefined ? latestHash : canonicalHeadHash };
    },
    async request({ method }: { method: string }) {
      assert.equal(method, "eth_accounts");
      if (rpcUnavailable) throw new Error("test reviewers unavailable");
      return accounts;
    },
    async getCode() { return registryCode; },
    async readContract({ functionName }: { functionName: string }) {
      if (functionName === "factory") return registryFactory;
      if (functionName === "reviewerA") return approvedReviewers[0];
      if (functionName === "reviewerB") return approvedReviewers[1];
      throw new Error("unexpected contract read");
    },
  } as unknown as PublicClient;
}

test("keeps core config and store identity usable with partial, malformed or colliding growth pins", () => {
  const ordinary = readLaunchpadRuntime(base)!;
  for (const overrides of [{ RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_RUNTIME_HASH: undefined },
    { RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_RUNTIME_HASH: "not-a-hash" },
    { RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_ADDRESS: factory }]) {
    const candidate = readLaunchpadRuntime({ ...enabled, ...overrides })!;
    assert.equal(candidate.scope, ordinary.scope);
    assert.deepEqual(candidate.deployment, ordinary.deployment);
    assert.equal(candidate.growthVaultDeployer, undefined);
    assert.equal(candidate.growthVaultTestFixture, undefined);
  }
});

test("a verified read-only registry pin alone cannot admit new growth opt-ins", async () => {
  const ordinary = readLaunchpadRuntime({ ...base, ...pins })!;
  assert.equal(await verifiedGrowthVaultDeployer(ordinary, mockRpc(), head), growthRegistry);
  assert.equal((await readBrowserLaunchpadDeployment(ordinary, mockRpc())).growthVaultDeployer, undefined);
  assert.equal(readLaunchpadRuntime({ ...enabled, VERCEL_ENV: "preview" }), null);
});

test("admits only the explicitly enabled fork fixture with both pinned disposable reviewers", async () => {
  assert.equal(config.deployment.growthVaultDeployer, undefined);
  const browser = await readBrowserLaunchpadDeployment(config, mockRpc());
  assert.deepEqual(browser, { ...config.deployment, growthVaultDeployer: growthRegistry });
  for (const rpc of [mockRpc({ accounts: [address(3), reviewers[0]] }), mockRpc({ rpcUnavailable: true }),
    mockRpc({ approvedReviewers: [reviewers[0], address(44)] }), mockRpc({ registryFactory: address(45) }),
    mockRpc({ registryCode: "0x1111" }), mockRpc({ anchorHash: hash(9) }),
    mockRpc({ chainId: 1 }), mockRpc({ canonicalHeadHash: hash(41) })]) {
    assert.deepEqual(await readBrowserLaunchpadDeployment(config, rpc), config.deployment);
  }
});
