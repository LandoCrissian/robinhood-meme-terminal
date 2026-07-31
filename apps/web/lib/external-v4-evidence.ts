export const UNISWAP_V4_HOOK_PERMISSIONS = [
  { flag: 1 << 13, id: "before-initialize", label: "Before initialize" },
  { flag: 1 << 12, id: "after-initialize", label: "After initialize" },
  { flag: 1 << 11, id: "before-add-liquidity", label: "Before add liquidity" },
  { flag: 1 << 10, id: "after-add-liquidity", label: "After add liquidity" },
  { flag: 1 << 9, id: "before-remove-liquidity", label: "Before remove liquidity" },
  { flag: 1 << 8, id: "after-remove-liquidity", label: "After remove liquidity" },
  { flag: 1 << 7, id: "before-swap", label: "Before swap" },
  { flag: 1 << 6, id: "after-swap", label: "After swap" },
  { flag: 1 << 5, id: "before-donate", label: "Before donate" },
  { flag: 1 << 4, id: "after-donate", label: "After donate" },
  { flag: 1 << 3, id: "before-swap-return-delta", label: "Before-swap return delta" },
  { flag: 1 << 2, id: "after-swap-return-delta", label: "After-swap return delta" },
  { flag: 1 << 1, id: "after-add-liquidity-return-delta", label: "After-add-liquidity return delta" },
  { flag: 1, id: "after-remove-liquidity-return-delta", label: "After-remove-liquidity return delta" }
] as const;

export type UniswapV4HookPermissionId = typeof UNISWAP_V4_HOOK_PERMISSIONS[number]["id"];

export function isUniswapV4PoolId(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function decodeUniswapV4HookPermissions(hook: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(hook)) return [];
  const flags = Number(BigInt(hook) & 0x3fffn);
  return UNISWAP_V4_HOOK_PERMISSIONS
    .filter((permission) => (flags & permission.flag) !== 0)
    .map((permission) => permission.id);
}

export type ExternalV4HookEvidence = {
  address: string;
  permissions: UniswapV4HookPermissionId[];
  affectsSwap: boolean;
  returnsSwapDelta: boolean;
  dynamicFee: boolean;
  codePresent: boolean;
  sourcePublished: boolean | null;
  isProxy: boolean | null;
  bytecodeChanged: boolean | null;
  contractName: string | null;
  customWriteFunctions: string[];
};

export type ExternalV4SellSimulation = {
  status: "passed" | "blocked" | "unavailable" | "not-run";
  method: "holder-permit2-router-sequence";
  holder: string | null;
  amountIn: string | null;
  quoteOut: string | null;
  minimumOut: string | null;
  testedAtBlock: string | null;
  calls: {
    tokenApproval: "passed" | "blocked" | "not-run";
    permit2Approval: "passed" | "blocked" | "not-run";
    swap: "passed" | "blocked" | "not-run";
  };
};

export type ExternalV4Evidence = {
  protocol: "uniswap-v4";
  token: string;
  poolId: string;
  poolManager: string;
  stateView: string;
  quoter: string;
  router: string;
  marketVerified: true;
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  poolState: {
    sqrtPriceX96: string;
    tick: number;
    protocolFee: number;
    lpFee: number;
    initializedAtBlock: string;
  };
  hook: ExternalV4HookEvidence;
  sellSimulation: ExternalV4SellSimulation;
  executionAssessment: {
    state: "eligible" | "review" | "blocked";
    reasons: string[];
  };
  warnings: string[];
  checkedAt: string;
};

type ExternalV4AssessmentInput = {
  hook: ExternalV4HookEvidence;
  sellSimulation: ExternalV4SellSimulation;
};

export function assessExternalV4Execution({
  hook,
  sellSimulation
}: ExternalV4AssessmentInput): ExternalV4Evidence["executionAssessment"] {
  const reasons: string[] = [];
  let state: ExternalV4Evidence["executionAssessment"]["state"] = "eligible";

  if (!hook.codePresent) {
    return {
      state: "blocked",
      reasons: ["The hook address has no contract code at the checked block."]
    };
  }
  if (hook.bytecodeChanged === true) {
    return {
      state: "blocked",
      reasons: ["The explorer reports that the published hook bytecode no longer matches."]
    };
  }
  if (sellSimulation.status === "blocked") {
    return {
      state: "blocked",
      reasons: ["The complete approval and sell route did not finish successfully in simulation."]
    };
  }

  if (sellSimulation.status === "unavailable") {
    state = "review";
    reasons.push("The complete sell rehearsal is temporarily unavailable.");
  } else if (sellSimulation.status === "not-run") {
    state = "review";
    reasons.push("RMT could not construct a supported native-ETH sell rehearsal for this pool.");
  }
  if (hook.address !== "0x0000000000000000000000000000000000000000") {
    if (hook.sourcePublished !== true) {
      state = "review";
      reasons.push("The hook source is not independently published and verified.");
    }
    if (hook.isProxy !== false) {
      state = "review";
      reasons.push(hook.isProxy
        ? "The hook is upgradeable or delegates to another implementation."
        : "RMT could not prove that the hook is non-upgradeable.");
    }
    if (hook.affectsSwap) {
      state = "review";
      reasons.push("The hook can execute logic before or after swaps.");
    }
    if (hook.returnsSwapDelta) {
      state = "review";
      reasons.push("The hook can alter swap input or output deltas.");
    }
    if (hook.customWriteFunctions.length > 0) {
      state = "review";
      reasons.push("The hook exposes project-specific state-changing controls.");
    }
  }
  if (sellSimulation.status === "passed") {
    reasons.unshift("A real holder completed the approval and sell route in a no-broadcast rehearsal.");
  }
  if (reasons.length === 0) {
    reasons.push("The canonical pool and complete sell route passed the current evidence checks.");
  }
  return { state, reasons };
}
