import assert from "node:assert/strict";
import { encodeAbiParameters, ExecutionRevertedError, getAddress } from "viem";
import {
  classifyRegisteredLiquidityPosition,
  resolveRegisteredLiquidityPosition
} from "./registered-liquidity-position";
import {
  fetchTokenRiskEvidence,
  scanPublishedTokenControls,
  simulateSellDirectionTransfer,
  solidityBlockNumber
} from "./token-risk-evidence";

const token = getAddress("0xcC333d246c75C14B087561F39F8c6FEf958CE54f");
const pair = getAddress("0x247bC73e70EBDecf6221B1A6E0564580938C5FFE");
const creator = getAddress("0x99e6c2Ebc0E3D86210Cf257CEB98E146CA045E01");
const whale = getAddress("0xA4990d06e247d3741d0711DdC8C4f4C9369E1d20");
const zero = "0x0000000000000000000000000000000000000000";

function mockFetch(options: {
  tokenAddress?: string;
  contractStatus?: number;
  contract?: Record<string, unknown>;
  holders?: unknown[];
} = {}) {
  return async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("action=getabi")) {
      if (options.contractStatus === 503) return new Response("missing", { status: 503 });
      const abi = options.contract?.abi;
      return Array.isArray(abi)
        ? Response.json({ status: "1", message: "OK", result: JSON.stringify(abi) })
        : Response.json({ status: "0", message: "NOTOK", result: "Contract source code not verified" });
    }
    if (url.includes("/smart-contracts/")) {
      if (options.contractStatus) return new Response("missing", { status: options.contractStatus });
      return Response.json(options.contract ?? {
        is_verified: true,
        proxy_type: null,
        implementations: [],
        is_changed_bytecode: false
      });
    }
    if (url.endsWith("/holders")) {
      return Response.json({
        items: options.holders ?? [
          { address: { hash: whale, is_contract: false }, value: "80" },
          { address: { hash: pair, is_contract: true }, value: "700" },
          { address: { hash: zero, is_contract: false }, value: "100" },
          { address: { hash: creator, is_contract: false }, value: "120" }
        ]
      });
    }
    return Response.json({
      address_hash: options.tokenAddress ?? token,
      holders_count: "92",
      total_supply: "1000"
    });
  };
}

async function main() {
  assert.equal(
    solidityBlockNumber({ number: 16n, l1BlockNumber: "0x20" }),
    32n
  );
  assert.equal(solidityBlockNumber({ number: "0x10" }), 16n);
  assert.equal(solidityBlockNumber({ number: "invalid" }), null);

  const passedSellSimulation = async (
    _token: typeof token,
    holder: typeof token,
    _pair: typeof token,
    amount: bigint
  ) => ({
    status: "passed" as const,
    method: "holder-to-pool-transfer" as const,
    holder,
    amount: amount.toString(),
    returnStyle: "boolean-true" as const
  });
  const scanned = scanPublishedTokenControls([
    {
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [{ type: "address" }, { type: "uint256" }],
      outputs: [{ type: "bool" }]
    },
    {
      type: "function",
      name: "mint",
      stateMutability: "nonpayable",
      inputs: [{ type: "address" }, { type: "uint256" }],
      outputs: []
    },
    {
      type: "function",
      name: "setSellTax",
      stateMutability: "nonpayable",
      inputs: [{ type: "uint256" }],
      outputs: []
    },
    {
      type: "function",
      name: "customRescue",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: []
    }
  ]);
  assert.deepEqual(scanned.customWriteFunctions, ["customRescue", "mint", "setSellTax"]);
  assert.deepEqual(scanned.detected, [
    { category: "supply", functionName: "mint" },
    { category: "fees", functionName: "setSellTax" }
  ]);

  const evidence = await fetchTokenRiskEvidence(
    { token, pair, creator },
    {
      fetch: mockFetch(),
      readCreatorBalance: async () => 120n,
      simulateSellTransfer: passedSellSimulation,
      now: () => Date.parse("2026-07-27T12:00:00.000Z")
    }
  );
  assert.equal(evidence.marketVerified, true);
  assert.equal(evidence.coverage, "complete");
  assert.equal(evidence.contract.sourcePublished, true);
  assert.equal(evidence.contract.isProxy, false);
  assert.equal(evidence.contract.bytecodeChanged, false);
  assert.equal(evidence.contract.controls.assessment, "unknown");
  assert.equal(evidence.liquidity.controlStatus, "not-proven");
  assert.equal(evidence.liquidity.evidenceSource, "none");
  assert.equal(evidence.liquidity.positionId, null);
  assert.equal(evidence.holders.count, 92);
  assert.equal(evidence.holders.poolShareBps, 7_000);
  assert.equal(evidence.holders.topNonPoolShareBps, 2_000);
  assert.deepEqual(evidence.holders.topNonPoolHolders, [
    { address: creator, shareBps: 1_200, isContract: false, isScam: false },
    { address: whale, shareBps: 800, isContract: false, isScam: false }
  ]);
  assert.equal(evidence.holders.largestNonPoolHolder?.address, creator);
  assert.equal(evidence.holders.largestNonPoolHolder?.shareBps, 1_200);
  assert.equal(evidence.holders.creatorShareBps, 1_200);
  assert.equal(evidence.sellSimulation.status, "passed");
  assert.equal(evidence.sellSimulation.holder, creator);
  assert.equal(evidence.sellSimulation.amount, "1");
  assert.match(evidence.warnings.join(" "), /non-pool address controls at least 10%/);
  assert.match(evidence.warnings.join(" "), /reported creator controls at least 10%/);
  assert.match(evidence.warnings.join(" "), /does not prove the liquidity position is locked/);
  assert.equal(evidence.checkedAt, "2026-07-27T12:00:00.000Z");

  let tokenOnlyLiquidityCalls = 0;
  let tokenOnlySellCalls = 0;
  const tokenOnly = await fetchTokenRiskEvidence(
    { token, creator },
    {
      fetch: mockFetch(),
      readCreatorBalance: async () => 120n,
      readLiquidityPosition: async () => {
        tokenOnlyLiquidityCalls += 1;
        throw new Error("Token-only evidence must not inspect an address-style liquidity position.");
      },
      simulateSellTransfer: async () => {
        tokenOnlySellCalls += 1;
        throw new Error("Token-only evidence must not simulate an address-pool transfer.");
      },
      now: () => Date.parse("2026-07-27T12:00:00.000Z")
    }
  );
  assert.equal(tokenOnly.marketVerified, false);
  assert.equal(tokenOnly.pair, null);
  assert.equal(tokenOnlyLiquidityCalls, 0);
  assert.equal(tokenOnlySellCalls, 0);
  assert.equal(tokenOnly.contract.sourcePublished, true);
  assert.equal(tokenOnly.contract.isProxy, false);
  assert.equal(tokenOnly.holders.count, 92);
  assert.equal(tokenOnly.holders.topHolderShareBps, 9_000);
  assert.equal(tokenOnly.holders.largestHolder?.address, pair);
  assert.equal(tokenOnly.holders.largestHolder?.shareBps, 7_000);
  assert.equal(tokenOnly.sellSimulation.status, "not-run");
  assert.doesNotMatch(tokenOnly.warnings.join(" "), /liquidity position|holder-to-pool|sellability/);

  const opaque = await fetchTokenRiskEvidence(
    { token, pair },
    {
      fetch: mockFetch({ contractStatus: 404 }),
      simulateSellTransfer: passedSellSimulation,
      now: () => 0
    }
  );
  assert.equal(opaque.contract.sourcePublished, false);
  assert.equal(opaque.contract.isProxy, null);
  assert.match(opaque.warnings.join(" "), /source is not published/);

  const delayedContract = await fetchTokenRiskEvidence(
    { token, pair },
    {
      fetch: mockFetch({ contractStatus: 503 }),
      simulateSellTransfer: passedSellSimulation,
      now: () => 0
    }
  );
  assert.equal(delayedContract.coverage, "partial");
  assert.equal(delayedContract.contract.sourcePublished, null);
  assert.equal(delayedContract.contract.controls.assessment, "unknown");
  assert.match(delayedContract.warnings.join(" "), /publication could not be verified/);

  const proxy = await fetchTokenRiskEvidence(
    { token, pair },
    {
      fetch: mockFetch({
        contract: {
          is_verified: true,
          proxy_type: "eip1967",
          implementations: [{}],
          is_changed_bytecode: true
        }
      }),
      simulateSellTransfer: passedSellSimulation
    }
  );
  assert.equal(proxy.contract.isProxy, true);
  assert.equal(proxy.contract.bytecodeChanged, true);
  assert.match(proxy.warnings.join(" "), /differs from the published source/);
  assert.match(proxy.warnings.join(" "), /token is a proxy/);

  const restricted = await fetchTokenRiskEvidence(
    { token, pair },
    {
      fetch: mockFetch({
        contract: {
          is_verified: true,
          proxy_type: null,
          implementations: [],
          is_changed_bytecode: false,
          abi: [
            {
              type: "function",
              name: "setInitialBuyRecipient",
              stateMutability: "nonpayable",
              inputs: [{ type: "address" }],
              outputs: []
            },
            {
              type: "function",
              name: "restrictionEndBlock",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "uint256" }]
            }
          ]
        }
      }),
      readControlState: async () => ({
        administrator: null,
        currentBlock: 100n,
        restrictionEndBlock: 200n,
        maxTransactionBps: 500,
        maxWalletBps: 550
      }),
      simulateSellTransfer: passedSellSimulation
    }
  );
  assert.equal(restricted.contract.controls.assessment, "review-required");
  assert.deepEqual(restricted.contract.controls.detected, [
    { category: "launch", functionName: "setInitialBuyRecipient" }
  ]);
  assert.equal(restricted.contract.controls.activeLaunchRestrictions, true);
  assert.equal(restricted.contract.controls.restrictionEndBlock, "200");
  assert.equal(restricted.contract.controls.maxTransactionBps, 500);
  assert.equal(restricted.contract.controls.maxWalletBps, 550);
  assert.match(restricted.warnings.join(" "), /launch restrictions are currently active/);

  const knownPonsProtection = await fetchTokenRiskEvidence(
    { token, pair, creator, sourceId: "pons" },
    {
      fetch: mockFetch({
        contract: {
          is_verified: true,
          proxy_type: null,
          implementations: [],
          is_changed_bytecode: false,
          abi: [
            {
              type: "function",
              name: "setInitialBuyRecipient",
              stateMutability: "nonpayable",
              inputs: [{ type: "address" }],
              outputs: []
            },
            {
              type: "function",
              name: "restrictionEndBlock",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "uint256" }]
            }
          ]
        }
      }),
      readControlState: async () => ({
        administrator: null,
        currentBlock: 300n,
        restrictionEndBlock: 200n,
        maxTransactionBps: 550,
        maxWalletBps: 500
      }),
      readCreatorBalance: async () => 120n,
      readLiquidityPosition: async () => ({
        controlStatus: "contract-held",
        evidenceSource: "launchpad-registry",
        positionManager: whale,
        positionId: "393642",
        owner: whale,
        approvedOperator: null,
        creatorCanTransfer: null,
        positionLiquidity: "123"
      }),
      simulateSellTransfer: passedSellSimulation
    }
  );
  assert.equal(
    knownPonsProtection.contract.controls.assessment,
    "known-launch-controls"
  );
  assert.equal(
    knownPonsProtection.contract.controls.activeLaunchRestrictions,
    false
  );
  assert.match(
    knownPonsProtection.warnings.join(" "),
    /factory-only launch protection is documented/
  );
  assert.doesNotMatch(
    knownPonsProtection.warnings.join(" "),
    /privileged control surfaces requiring review/
  );

  const unverifiedPonsClaim = await fetchTokenRiskEvidence(
    { token, pair, creator, sourceId: "pons" },
    {
      fetch: mockFetch({
        contract: {
          is_verified: true,
          proxy_type: null,
          implementations: [],
          is_changed_bytecode: false,
          abi: [
            {
              type: "function",
              name: "setInitialBuyRecipient",
              stateMutability: "nonpayable",
              inputs: [{ type: "address" }],
              outputs: []
            },
            {
              type: "function",
              name: "restrictionEndBlock",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "uint256" }]
            }
          ]
        }
      }),
      readControlState: async () => ({
        administrator: null,
        currentBlock: 300n,
        restrictionEndBlock: 200n,
        maxTransactionBps: 550,
        maxWalletBps: 500
      }),
      readCreatorBalance: async () => 120n,
      simulateSellTransfer: passedSellSimulation
    }
  );
  assert.equal(
    unverifiedPonsClaim.contract.controls.assessment,
    "review-required"
  );

  const blockedEvidence = await fetchTokenRiskEvidence(
    { token, pair },
    {
      fetch: mockFetch(),
      simulateSellTransfer: async (_token, holder, _pair, amount) => ({
        status: "blocked",
        method: "holder-to-pool-transfer",
        holder,
        amount: amount.toString(),
        returnStyle: null
      })
    }
  );
  assert.equal(blockedEvidence.sellSimulation.status, "blocked");
  assert.match(blockedEvidence.warnings.join(" "), /blocked buys/);

  const passedBoolean = await simulateSellDirectionTransfer(token, whale, pair, 1n, {
    call: async () => ({
      data: encodeAbiParameters([{ type: "bool" }], [true])
    })
  });
  assert.equal(passedBoolean.status, "passed");
  assert.equal(passedBoolean.returnStyle, "boolean-true");

  const passedLegacy = await simulateSellDirectionTransfer(token, whale, pair, 1n, {
    call: async () => ({ data: "0x" })
  });
  assert.equal(passedLegacy.status, "passed");
  assert.equal(passedLegacy.returnStyle, "no-return-data");

  const falseReturn = await simulateSellDirectionTransfer(token, whale, pair, 1n, {
    call: async () => ({
      data: encodeAbiParameters([{ type: "bool" }], [false])
    })
  });
  assert.equal(falseReturn.status, "blocked");

  const reverted = await simulateSellDirectionTransfer(token, whale, pair, 1n, {
    call: async () => {
      throw new ExecutionRevertedError({ message: "transfer blocked" });
    }
  });
  assert.equal(reverted.status, "blocked");

  const unavailable = await simulateSellDirectionTransfer(token, whale, pair, 1n, {
    call: async () => {
      throw new Error("RPC unavailable");
    }
  });
  assert.equal(unavailable.status, "unavailable");

  const registeredPosition = await resolveRegisteredLiquidityPosition(
    { token, pair, creator, sourceId: "pons" },
    {
      readPosition: async () => ({
        manager: getAddress("0x51d0e5188afe12d502e29d982d20c190e7816107"),
        positionId: 1199n,
        owner: creator,
        approvedOperator: getAddress(zero),
        creatorApprovedForAll: false,
        token0: token,
        token1: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
        fee: 10_000,
        liquidity: 123n,
        canonicalPair: pair,
        managerCode: "0x1234",
        ownerCode: undefined
      })
    }
  );
  assert.equal(registeredPosition.evidenceSource, "launchpad-registry");
  assert.equal(registeredPosition.controlStatus, "creator-controlled");
  assert.equal(registeredPosition.creatorCanTransfer, true);
  assert.equal(registeredPosition.positionId, "1199");
  assert.equal(registeredPosition.approvedOperator, null);

  const contractHeld = classifyRegisteredLiquidityPosition({
    creator,
    owner: whale,
    approvedOperator: getAddress(zero),
    creatorApprovedForAll: false,
    ownerHasCode: true
  });
  assert.equal(contractHeld.controlStatus, "contract-held");
  assert.equal(contractHeld.creatorCanTransfer, null);

  const mismatchedPosition = await resolveRegisteredLiquidityPosition(
    { token, pair, creator, sourceId: "pons" },
    {
      readPosition: async () => ({
        manager: getAddress("0x51d0e5188afe12d502e29d982d20c190e7816107"),
        positionId: 1199n,
        owner: creator,
        approvedOperator: getAddress(zero),
        creatorApprovedForAll: false,
        token0: token,
        token1: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
        fee: 10_000,
        liquidity: 123n,
        canonicalPair: whale,
        managerCode: "0x1234",
        ownerCode: undefined
      })
    }
  );
  assert.equal(mismatchedPosition.controlStatus, "not-proven");
  assert.equal(mismatchedPosition.positionId, null);

  await assert.rejects(
    fetchTokenRiskEvidence(
      { token, pair },
      { fetch: mockFetch({ tokenAddress: whale }) }
    ),
    /different token/
  );
  await assert.rejects(
    fetchTokenRiskEvidence(
      { token, pair },
      { fetch: async () => new Response("down", { status: 503 }) }
    ),
    /unavailable/
  );

  console.log("Token risk evidence excludes pools, fails closed, and labels transparency without implying safety.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
