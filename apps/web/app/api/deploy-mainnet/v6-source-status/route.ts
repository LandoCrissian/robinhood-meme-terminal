import { NextResponse } from "next/server";

const BLOCKSCOUT_API = "https://robinhoodchain.blockscout.com/api/v2/smart-contracts";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EXPECTED_COMPILER = "v0.8.26+commit.8a97fa7a";

const EXPECTED_CONTRACTS = {
  governance: "RMTV6Governance",
  versionRegistry: "VersionedFactoryRegistry",
  legacyFactory: "LowCostMemeLaunchFactoryV5",
  hook: "V5GraduationHook",
  adapter: "V4GraduationAdapter",
  launchGate: "RMTLaunchGate",
  policyRegistry: "RMTLaunchPolicyRegistry",
  marketImplementation: "CloneBondingCurveMarketV6",
  tokenImplementation: "CloneFixedSupplyMemeToken",
  feeSplitterImplementation: "DirectLaunchFeeSplitter",
  officialMigration: "OfficialRMTIdentityMigration",
  factory: "RMTLaunchFactoryV6"
} as const;

type ContractKey = keyof typeof EXPECTED_CONTRACTS;

type BlockscoutContract = {
  is_verified?: unknown;
  is_fully_verified?: unknown;
  is_partially_verified?: unknown;
  is_changed_bytecode?: unknown;
  name?: unknown;
  language?: unknown;
  compiler_version?: unknown;
  compiler_settings?: unknown;
  optimization_enabled?: unknown;
  optimization_runs?: unknown;
  creation_status?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseAddresses(value: unknown) {
  if (!isRecord(value) || !isRecord(value.contracts)) return undefined;
  const contracts = {} as Record<ContractKey, string>;

  for (const key of Object.keys(EXPECTED_CONTRACTS) as ContractKey[]) {
    const address = value.contracts[key];
    if (typeof address !== "string" || !ADDRESS_PATTERN.test(address)) return undefined;
    contracts[key] = address;
  }

  if (Object.keys(value.contracts).length !== Object.keys(EXPECTED_CONTRACTS).length) return undefined;
  return contracts;
}

function verificationFailures(contract: BlockscoutContract, expectedName: string) {
  const failures: string[] = [];
  if (contract.is_verified !== true) failures.push("not verified");
  if (contract.is_fully_verified !== true) failures.push("not fully verified");
  if (contract.is_partially_verified !== false) failures.push("partial verification reported");
  if (contract.is_changed_bytecode !== false) failures.push("changed bytecode reported");
  if (contract.name !== expectedName) failures.push(`expected source ${expectedName}`);
  if (contract.language !== "solidity") failures.push("language is not Solidity");
  if (contract.compiler_version !== EXPECTED_COMPILER) failures.push(`compiler is not ${EXPECTED_COMPILER}`);
  if (contract.optimization_enabled !== true || contract.optimization_runs !== 200) {
    failures.push("optimizer settings do not match 200 runs");
  }
  if (!isRecord(contract.compiler_settings) || contract.compiler_settings.viaIR !== true) {
    failures.push("via-IR compiler setting is not reported");
  } else {
    const optimizer = contract.compiler_settings.optimizer;
    if (!isRecord(optimizer) || optimizer.enabled !== true || optimizer.runs !== 200) {
      failures.push("compiler-settings optimizer does not match 200 runs");
    }
    const compilationTarget = contract.compiler_settings.compilationTarget;
    if (!isRecord(compilationTarget)
      || Object.keys(compilationTarget).length !== 1
      || Object.values(compilationTarget)[0] !== expectedName) {
      failures.push(`compilation target is not exactly ${expectedName}`);
    }
  }
  if (contract.creation_status !== "success") failures.push("successful creation is not reported");
  return failures;
}

async function checkContract(key: ContractKey, address: string) {
  const response = await fetch(`${BLOCKSCOUT_API}/${address}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    return {
      key,
      address,
      expectedName: EXPECTED_CONTRACTS[key],
      verified: false,
      failures: [`Blockscout returned ${response.status}`]
    };
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    return {
      key,
      address,
      expectedName: EXPECTED_CONTRACTS[key],
      verified: false,
      failures: ["Blockscout returned a malformed contract record"]
    };
  }

  const failures = verificationFailures(payload as BlockscoutContract, EXPECTED_CONTRACTS[key]);
  return { key, address, expectedName: EXPECTED_CONTRACTS[key], verified: failures.length === 0, failures };
}

export async function POST(request: Request) {
  try {
    const contracts = parseAddresses(await request.json());
    if (!contracts) {
      return NextResponse.json(
        { error: "All twelve reviewed V6 contracts and critical RMT dependencies are required." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const results = await Promise.all(
      (Object.keys(EXPECTED_CONTRACTS) as ContractKey[]).map((key) => checkContract(key, contracts[key]))
    );

    return NextResponse.json(
      {
        verified: results.every((result) => result.verified),
        checkedAt: new Date().toISOString(),
        contracts: results
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Blockscout source verification is unavailable. No proposal may be submitted." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
