import assert from "node:assert/strict";
import { getAddress } from "viem";
import { fetchTokenRiskEvidence } from "./token-risk-evidence";

const PONS_TOKEN = getAddress("0x39dbed3a2bd333467115de45665cc57f813c4571");

async function main() {
  const apiKey = process.env.RMT_BLOCKSCOUT_PRO_API_KEY;
  if (!apiKey) {
    throw new Error("RMT_BLOCKSCOUT_PRO_API_KEY is required for the read-only Blockscout PRO live smoke.");
  }

  const evidence = await fetchTokenRiskEvidence(
    { token: PONS_TOKEN, sourceId: "pons" },
    { apiKey }
  );

  assert.equal(evidence.domains?.token, "ready");
  assert.equal(evidence.domains?.holders, "ready");
  assert.equal(evidence.domains?.contract, "ready");
  assert.equal(evidence.domains?.abi, "ready");
  assert.ok((evidence.holders.count ?? 0) > 0, "PONS should have a nonzero current holder count.");
  assert.equal(evidence.contract.sourcePublished, true);
  assert.notEqual(evidence.contract.controls.assessment, "unknown");

  console.log("PONS Blockscout PRO token, holders, published contract, ABI, and controls evidence passed.");
}

void main();
