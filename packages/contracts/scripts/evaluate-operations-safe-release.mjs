import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runMobileSenderProbe } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { operationsFeeApprovalSource, verifyOperationsSafeEvidence } from "./prepare-operations-safe.mjs";
import { privateOutputPath } from "./prepare-unsigned-4663.mjs";

const status = "BLOCKED_NO_BROADCAST";
const proposedPolicy = Object.freeze({
  state: "OWNER_ADOPTION_REQUIRED",
  scope: "OPERATIONS_SAFE_1_ONLY",
  proposal: "https://github.com/LandoCrissian/robinhood-meme-terminal/issues/654",
  conditionalFeeApproval: operationsFeeApprovalSource,
  currentSigningDecision: "BLOCKED_RELEASE_GATES",
  launchProtocolReleaseEvaluated: false,
});

function report(technicalStatus, details) {
  return {
    schemaVersion: 1,
    scope: "READ_ONLY_4663_OPERATIONS_SAFE_1_RELEASE_EVIDENCE",
    technicalStatus,
    status,
    policy: proposedPolicy,
    transactionApproval: null,
    signingReviewEligible: false,
    broadcastAuthorized: false,
    ...details,
  };
}

// Technical evidence does not adopt policy or change the owner's conditional fee approval.
// The only live entry point creates its own fresh read-only observation.
export function evaluateOperationsSafeRelease(observation, nowMs = Date.now()) {
  const evidence = verifyOperationsSafeEvidence(observation, nowMs);
  const withinFeeCeiling = evidence.feeCapStatus === "WITHIN_APPROVED_CEILING";
  return report(withinFeeCeiling ? "PASS" : "BLOCKED_FEE_CEILING", {
    evidence,
    nextDecision: withinFeeCeiling
      ? "Adopt the Operations Safe #1 release policy explicitly, then separately review a fresh matching transaction."
      : "Wait for refreshed estimates to fit every approved fee field, or obtain a new exact fee approval.",
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let output;
  let result;
  try {
    const { values } = parseArgs({ options: { out: { type: "string" } } });
    output = values.out && privateOutputPath(values.out);
    const observation = await runMobileSenderProbe({ allowPinnedDelegation: true, operationsOnly: true });
    result = evaluateOperationsSafeRelease(observation);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split(/\r?\n/)[0].slice(0, 240) : "Unverified read-only observation";
    result = report("UNVERIFIED", {
      reason,
      nextDecision: "Refresh and verify the evidence. Changed transaction identity requires an exact new review.",
    });
  }
  const json = JSON.stringify(result, null, 2) + "\n";
  if (output) writeFileSync(output, json, { flag: "wx", mode: 0o600 });
  else process.stdout.write(json);
  if (result.technicalStatus !== "PASS") process.exitCode = 1;
}
