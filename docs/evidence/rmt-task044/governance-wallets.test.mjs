import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { normalizeGovernanceWallets, observeGovernanceWallets, proposals } from "./governance-wallets.mjs";

const { getAddress } = webTools(process.env.RMT_DEPLOYMENT_TEST_CHECKOUT || fileURLToPath(new URL("../../../", import.meta.url)));
const wallets = normalizeGovernanceWallets(proposals, getAddress);
const blockNumber = 118_000_000n;
const blockHash = "0x" + "11".repeat(32);
const block = { number: "0x" + blockNumber.toString(16), hash: blockHash, stateRoot: "0x" + "12".repeat(32), timestamp: "0x10000000" };

function mockReads({ code = "0x", unstable = false, wrongChain = false, codeSecond = code }) {
  const blockReads = { official: 0, pinax: 0 };
  const counts = { official: 0, pinax: 0 };
  const read = Object.fromEntries(Object.keys(blockReads).map((provider) => [provider, async (method, args) => {
    if (method === "eth_chainId") return wrongChain && provider === "pinax" ? "0x1" : "0x1237";
    if (method === "eth_getBlockByNumber") {
      assert.deepEqual(args, [block.number, false]);
      if (++blockReads[provider] > 1 && unstable && provider === "official") return { ...block, hash: "0x" + "22".repeat(32) };
      return block;
    }
    assert.equal(method, "eth_getCode");
    assert.equal(args[1], block.number);
    assert.equal(args[0], wallets[counts[provider]++].address);
    return provider === "official" ? code : codeSecond;
  }]));
  return { read, wallets, blockNumber, expectedHash: blockHash, counts };
}

test("exact owner bytes produce three distinct EIP-55 addresses", () => {
  assert.deepEqual(wallets.map(({ address }) => address), [
    "0xC447A378cFd8460Febc2eef67501D7a5473B9001",
    "0xC3600f2Df60929D2AB9ab294CFF42EEDCB984f51",
    "0x2Bcc3fAfCE77cCc7fdBED46E0B5bb80bA3E76697",
  ]);
  assert.ok(wallets.every(({ aboveReservedRange, address, submittedAddress }) => aboveReservedRange
    && address.toLowerCase() === submittedAddress));
  const invalid = (submittedAddress) => [{ ...proposals[0], submittedAddress }, ...proposals.slice(1)];
  assert.throws(() => normalizeGovernanceWallets(invalid("0x123"), getAddress), /owner confirmation/);
  assert.throws(() => normalizeGovernanceWallets(invalid("0xc447A378cFd8460Febc2eef67501D7a5473B9001"), getAddress),
    /checksum|invalid/i);
  assert.throws(() => normalizeGovernanceWallets(invalid(proposals[1].submittedAddress), getAddress), /Duplicate/);
});

test("matching code-empty observations establish policy eligibility with key control unverified", async () => {
  const fixture = mockReads({});
  const evidence = await observeGovernanceWallets(fixture);
  assert.equal(evidence.status, "ELIGIBLE_AT_PINNED_BLOCK");
  assert.equal(evidence.anchor.hash, blockHash);
  assert.deepEqual(fixture.counts, { official: 3, pinax: 3 });
  for (const wallet of evidence.wallets) {
    assert.deepEqual(wallet.codes, { official: "0x", pinax: "0x" });
    assert.equal(wallet.policyEligible, true);
    assert.equal(wallet.keyControl, "UNVERIFIED");
  }
});

test("contract code, delegated EOAs and low reserved addresses are ineligible", async () => {
  for (const [code, codeState] of [["0x6000", "CONTRACT_CODE"], ["0xef0100" + "11".repeat(20), "EIP_7702_DELEGATION"]]) {
    const evidence = await observeGovernanceWallets(mockReads({ code }));
    assert.equal(evidence.status, "INELIGIBLE_AT_PINNED_BLOCK");
    assert.ok(evidence.wallets.every((wallet) => wallet.codeState === codeState && wallet.policyEligible === false));
  }
  const reserved = normalizeGovernanceWallets([{ ...proposals[0], submittedAddress: "0x" + "0".repeat(36) + "ffff" }, ...proposals.slice(1)],
    getAddress);
  assert.equal(reserved[0].aboveReservedRange, false);
});

test("mixed chains, anchor changes and code disagreement fail closed", async () => {
  const wrongChain = mockReads({ wrongChain: true });
  await assert.rejects(() => observeGovernanceWallets(wrongChain), /Unexpected provider chain/);
  assert.deepEqual(wrongChain.counts, { official: 0, pinax: 0 });
  await assert.rejects(() => observeGovernanceWallets(mockReads({ unstable: true })), /observation changed/);
  await assert.rejects(() => observeGovernanceWallets(mockReads({ codeSecond: "0x6000" })), /disagree on account code/);
  await assert.rejects(() => observeGovernanceWallets({ ...mockReads({}), expectedHash: "0x" + "31".repeat(32) }), /pinned block hash/);
});
