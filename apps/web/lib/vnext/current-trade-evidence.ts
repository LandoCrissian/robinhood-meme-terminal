import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import type { VNextAuthorizationPlan } from "./authorization-plan";

/** Render-time check as well as asynchronous generation checks: no stale-frame authority. */
export function currentTradeEvidence(evidence: VNextPreSignEvidence | undefined, plan: VNextAuthorizationPlan | undefined,
  context: { published: string | null; current: string; wallet?: string; input: string | null; output: string | null; amount?: string; now: number }) {
  const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  return evidence && plan && context.published === context.current && plan.expiresAtMs > context.now && evidence.expiresAtMs > context.now
    && evidence.chainId === 4663 && plan.chainId === 4663
    && same(evidence.recipient, context.wallet) && same(plan.recipient, context.wallet)
    && same(evidence.inputAsset, context.input) && same(evidence.outputAsset, context.output)
    && same(plan.inputAsset, context.input) && same(plan.outputAsset, context.output)
    && evidence.inputAmountAtomic === context.amount && plan.inputAmountAtomic === context.amount
    && evidence.provider === plan.provider && evidence.sourceQuoteRequestId === plan.sourceQuoteRequestId
    && evidence.verificationId === plan.sourceVerificationId && evidence.protectedOutputAtomic === plan.protectedOutputAtomic
    ? evidence : undefined;
}
