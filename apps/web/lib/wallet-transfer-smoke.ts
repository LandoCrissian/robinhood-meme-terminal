import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareNativeTransfer, safeTransferMessage } from "./wallet-transfer";

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";

assert.deepEqual(prepareNativeTransfer({ recipient, amount: "0.01", sender, balance: 20_000_000_000_000_000n }), {
  recipient,
  value: 10_000_000_000_000_000n
});
assert.throws(() => prepareNativeTransfer({ recipient: "not-an-address", amount: "1", sender }), /valid EVM wallet/);
assert.throws(() => prepareNativeTransfer({ recipient: sender, amount: "1", sender }), /other than the active wallet/);
assert.throws(() => prepareNativeTransfer({ recipient: "0x0000000000000000000000000000000000000000", amount: "1", sender }), /zero address/);
assert.throws(() => prepareNativeTransfer({ recipient, amount: "0", sender }), /greater than zero/);
assert.throws(() => prepareNativeTransfer({ recipient, amount: "1.1234567890123456789", sender }), /18 decimal places/);
assert.throws(() => prepareNativeTransfer({ recipient, amount: "0.01", sender, balance: 10_000_000_000_000_000n }), /network fee/);
assert.equal(safeTransferMessage("User rejected the request"), "Transfer cancelled. No funds were moved.");

const dialog = readFileSync(new URL("../app/wallet-transfer-dialog.tsx", import.meta.url), "utf8");
assert.match(dialog, /Review transfer/);
assert.match(dialog, /Confirm in wallet/);
assert.match(dialog, /useSendTransaction/);
assert.match(dialog, /chainId: targetChain\.id/);
assert.match(dialog, /RMT never changes the destination/);
assert.doesNotMatch(dialog, /privateKey|authorizationPrivateKey|appSecret|useSigners|useSessionSigners/);

console.log("Wallet transfers remain exact, user-reviewed, and wallet-confirmed.");
