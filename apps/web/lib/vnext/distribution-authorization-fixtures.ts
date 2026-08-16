import { getAddress, type Hex } from "viem";
import {
  RMT_DISTRIBUTION_CHAIN_ID,
  buildDistributionManifestV1,
  type BuildDistributionManifestInput,
  type DistributionActionKind
} from "./distribution-domain";
import { buildDistributionAuthorizationPlanV1 } from "./distribution-authorization";

const sender = getAddress("0x1111111111111111111111111111111111111111");
const engine = getAddress("0x2222222222222222222222222222222222222222");
const sink = getAddress("0x3333333333333333333333333333333333333333");
const rmt = getAddress("0x4444444444444444444444444444444444444444");
const asset20 = getAddress("0x5555555555555555555555555555555555555555");
const asset721 = getAddress("0x6666666666666666666666666666666666666666");
const asset1155 = getAddress("0x7777777777777777777777777777777777777777");
const alice = getAddress("0x8888888888888888888888888888888888888888");
const bob = getAddress("0x9999999999999999999999999999999999999999");
const HASH_A = `0x${"a".repeat(64)}` as Hex;
const HASH_B = `0x${"b".repeat(64)}` as Hex;
const HASH_C = `0x${"c".repeat(64)}` as Hex;

function input(actionKind: DistributionActionKind): BuildDistributionManifestInput {
  const asset = actionKind.startsWith("erc20")
    ? { address: asset20, standard: "erc20" as const, decimals: 6 }
    : actionKind === "erc721"
      ? { address: asset721, standard: "erc721" as const, decimals: null }
      : { address: asset1155, standard: "erc1155" as const, decimals: null };
  const csv = actionKind === "erc20_equal"
    ? `recipient\n${alice}\n${bob}\n`
    : actionKind === "erc20_custom"
      ? `recipient,amount\n${alice},1\n${bob},2\n`
      : actionKind === "erc721"
        ? `recipient,tokenId\n${alice},1\n${bob},2\n`
        : `recipient,tokenId,amount\n${alice},1,2\n${bob},2,3\n`;
  return {
    sender,
    actionKind,
    asset: { chainId: RMT_DISTRIBUTION_CHAIN_ID, ...asset },
    csv,
    equalAmount: actionKind === "erc20_equal" ? "1" : undefined,
    infrastructure: {
      engine,
      engineRuntimeHash: HASH_A,
      retirementSink: sink,
      retirementSinkRuntimeHash: HASH_B,
      rmtToken: rmt,
      rmtTokenRuntimeHash: HASH_C,
      utilityPolicyVersion: 1,
      erc20CostPerRecipientAtomic: "7",
      erc721CostPerRecipientAtomic: "11",
      erc1155CostPerRecipientAtomic: "13"
    },
    gasEvidence: {
      chainId: RMT_DISTRIBUTION_CHAIN_ID,
      actionKind,
      measuredAtBlock: "40000000",
      blockGasLimit: "1000000",
      safetyMarginBps: 8000,
      source: "fork_simulation",
      samples: [{ recipientCount: 1, gasUsed: "200000" }, { recipientCount: 2, gasUsed: "300000" }]
    }
  };
}

export function buildDistributionAuthorizationFixtureSetV1() {
  return (["erc20_equal", "erc20_custom", "erc721", "erc1155"] as const).map((actionKind) => {
    const manifest = buildDistributionManifestV1(input(actionKind));
    return { actionKind, manifest, plan: buildDistributionAuthorizationPlanV1(manifest, 0) };
  });
}
