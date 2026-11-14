import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { assertCurveLaunchBinding, fixtureChainId, fixtureConfirmations, type CurveFixtureBinding } from "./curve-launch-evidence.js";
import type { Address, Hash } from "viem";

export const curveFixtureProfile = "task036-local-only";

function explicitPort(value: string) {
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) < 1_024 || Number(value) > 65_535) throw new Error("Fixture requires its explicit unprivileged port");
  return Number(value);
}

function loopbackUrl(value: string | undefined, protocol: "http:" | "postgresql:") {
  if (!value) throw new Error("Fixture loopback URL is missing");
  const url = new URL(value);
  if (url.protocol !== protocol || url.hostname !== "127.0.0.1" || url.search || url.hash || !url.port) {
    throw new Error("Fixture requires a loopback URL with an explicit port");
  }
  explicitPort(url.port);
  return url;
}

export function curveFixtureConfig(env: NodeJS.ProcessEnv) {
  if (env.RMT_CURVE_FIXTURE !== curveFixtureProfile) throw new Error("Isolated curve fixture is disabled");
  const port = explicitPort(env.RMT_CURVE_FIXTURE_PORT ?? "");
  const rpc = loopbackUrl(env.RMT_CURVE_FIXTURE_RPC, "http:");
  if (rpc.username || rpc.password || rpc.pathname !== "/") throw new Error("Fixture RPC must be a bare loopback origin");
  const database = loopbackUrl(env.RMT_CURVE_FIXTURE_DATABASE, "postgresql:");
  if (!database.username || !/^\/rmt_curve_fixture_[a-z0-9_]{1,36}$/.test(database.pathname)) {
    throw new Error("Fixture PostgreSQL must use a dedicated rmt_curve_fixture database");
  }
  if (new Set([port, Number(rpc.port), Number(database.port)]).size !== 3) throw new Error("Fixture services require distinct ports");
  const manifest = env.RMT_CURVE_FIXTURE_DEPLOYMENT;
  if (!manifest || !isAbsolute(manifest) || statSync(manifest).size > 128 * 1024) throw new Error("Fixture deployment manifest is missing or too large");
  const data: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid fixture deployment manifest");
  const row = data as Record<string, unknown>;
  if (row.chainId !== fixtureChainId || typeof row.deployBlock !== "string" || !/^[1-9]\d{0,15}$/.test(row.deployBlock)
      || row.creationFeeWei !== "400000000000000") throw new Error("Invalid fixture chain, height or exact creation fee");
  const binding: CurveFixtureBinding = {
    chainId: fixtureChainId, profile: curveFixtureProfile, engineVersion: 1, confirmations: fixtureConfirmations,
    deploymentBlock: BigInt(row.deployBlock), deploymentBlockHash: row.deploymentBlockHash as Hash,
    factory: row.factory as Address, factoryRuntimeHash: row.factoryRuntimeHash as Hash,
    projectRegistry: row.projectRegistry as Address, projectRegistryRuntimeHash: row.registryRuntimeHash as Hash,
    creationFeeRecipient: row.creationFeeRecipient as Address, creationFeeWei: BigInt(row.creationFeeWei),
  };
  assertCurveLaunchBinding(binding);
  return { binding, rpcUrl: rpc.href, databaseUrl: database.href, databaseName: database.pathname.slice(1), port };
}
