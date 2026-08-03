import assert from "node:assert/strict";
import { recoverTypedDataAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildCreatorSplitManifest,
  hashCreatorSplitConfig
} from "./creator-split-manifest";

const fixedInput = {
  chainId: 4_663,
  releaseRegistry: "0x1111111111111111111111111111111111111111",
  releaseId: `0x${"22".repeat(32)}`,
  creator: "0x3333333333333333333333333333333333333333",
  module: "0x4444444444444444444444444444444444444444",
  currentTimestamp: 1_785_369_600,
  consentDeadline: 1_785_456_000,
  recipients: [
    {
      recipient: "0x6666666666666666666666666666666666666666",
      shareBps: 3_000,
      recoveryAddress: "0x8888888888888888888888888888888888888888"
    },
    {
      recipient: "0x5555555555555555555555555555555555555555",
      shareBps: 7_000,
      recoveryAddress: "0x7777777777777777777777777777777777777777"
    }
  ]
} as const;

const fixedManifest = buildCreatorSplitManifest(fixedInput);
assert.deepEqual(fixedManifest.config.recipients, [
  "0x5555555555555555555555555555555555555555",
  "0x6666666666666666666666666666666666666666"
]);
assert.equal(
  fixedManifest.configurationHash,
  "0xd8401496f691bca6786ed4020323865df39c19f2c5c49d0ffc166c13185aa974"
);
assert.equal(
  fixedManifest.payoutManifestHash,
  "0x5e6736b4665d23c589749ad769d9a9c282c1676fb04632e224521439abda5c11"
);
assert.equal(
  fixedManifest.consentManifestHash,
  "0x602ac0f1f76e7cc900271376ce8eaf3db40c41ef36ed44946ad9e7852797139f"
);
assert.deepEqual(
  fixedManifest.consentRequests.map((request) => request.digest),
  [
    "0x768aee4bf63070465391655f005a2ecc6f156fe8886943dc95f1c9a30583df0b",
    "0x2808869db13dd6e753c1c27a78f1523aecfa5048dc54d027c3c2519e2dd791c7"
  ]
);
assert.equal(fixedManifest.totalShareBps, 10_000);
assert.equal(fixedManifest.contractExecution, "disabled");
assert.deepEqual(hashCreatorSplitConfig(fixedManifest.config), {
  configurationHash: fixedManifest.configurationHash,
  payoutManifestHash: fixedManifest.payoutManifestHash,
  consentManifestHash: fixedManifest.consentManifestHash
});

async function runAsyncChecks() {
  const firstAccount = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const secondAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const signedManifest = buildCreatorSplitManifest({
    ...fixedInput,
    recipients: [
      {
        recipient: secondAccount.address,
        shareBps: 3_000,
        recoveryAddress: "0x8888888888888888888888888888888888888888"
      },
      {
        recipient: firstAccount.address,
        shareBps: 7_000
      }
    ]
  });
  const firstRequest = signedManifest.consentRequests.find(
    (request) => request.recipient === firstAccount.address
  );
  assert.ok(firstRequest);
  assert.equal(firstRequest.recoveryAddress, zeroAddress);
  const firstSignature = await firstAccount.signTypedData(firstRequest.typedData);
  assert.equal(
    await recoverTypedDataAddress({
      ...firstRequest.typedData,
      signature: firstSignature
    }),
    firstAccount.address
  );

  const alteredRecovery = buildCreatorSplitManifest({
    ...fixedInput,
    recipients: fixedInput.recipients.map((entry, index) => index === 1
      ? { ...entry, recoveryAddress: "0x9999999999999999999999999999999999999999" }
      : entry)
  });
  assert.notEqual(alteredRecovery.configurationHash, fixedManifest.configurationHash);
  assert.notEqual(
    alteredRecovery.consentRequests[0].digest,
    fixedManifest.consentRequests[0].digest
  );

  assert.throws(() => buildCreatorSplitManifest({
    ...fixedInput,
    recipients: [
      fixedInput.recipients[0],
      { ...fixedInput.recipients[0], shareBps: 7_000 }
    ]
  }), /unique/);
  assert.throws(() => buildCreatorSplitManifest({
    ...fixedInput,
    recipients: fixedInput.recipients.map((entry, index) => (
      index === 0 ? { ...entry, shareBps: 2_999 } : entry
    ))
  }), /exactly 100%/);
  assert.throws(() => buildCreatorSplitManifest({
    ...fixedInput,
    consentDeadline: fixedInput.currentTimestamp
  }), /next 30 days/);
  assert.throws(() => buildCreatorSplitManifest({
    ...fixedInput,
    consentDeadline: fixedInput.currentTimestamp + 31 * 24 * 60 * 60
  }), /next 30 days/);
  assert.throws(() => buildCreatorSplitManifest({
    ...fixedInput,
    releaseId: `0x${"00".repeat(32)}`
  }), /cannot be zero/);
}

runAsyncChecks()
  .then(() => console.log("creator split manifest smoke checks passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
