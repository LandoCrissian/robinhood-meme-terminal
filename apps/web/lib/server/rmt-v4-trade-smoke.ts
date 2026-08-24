import assert from "node:assert/strict";
import { decodeAbiParameters, decodeFunctionData, getAddress, keccak256, parseAbiParameters, zeroAddress, type Hex } from "viem";
import { ROUTER_AS_RECIPIENT } from "../uniswap-v4";
import { buildRmtV4Swap } from "./rmt-v4-trade";

const routerAbi = [{ type: "function", name: "execute", stateMutability: "payable", inputs: [{ name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }, { name: "deadline", type: "uint256" }], outputs: [] }] as const;

function inspectRoute(calldata: Hex) {
  const decoded = decodeFunctionData({ abi: routerAbi, data: calldata });
  const [commands, inputs, routeDeadline] = decoded.args;
  const v4Input = inputs[commands === "0x100404" ? 0 : 1];
  const [actions, actionParams] = decodeAbiParameters(parseAbiParameters("bytes, bytes[]"), v4Input);
  const [takeCurrency, takeRecipient, takeAmount] = decodeAbiParameters(parseAbiParameters("address, address, uint256"), actionParams[2]);
  const sweepInput = inputs[commands === "0x100404" ? 1 : 2];
  const [sweepCurrency, sweepRecipient] = decodeAbiParameters(parseAbiParameters("address, address, uint256"), sweepInput);
  return { commands, routeDeadline, actions, takeCurrency, takeRecipient, takeAmount, sweepCurrency, sweepRecipient };
}

// Historical calldata fixture only; this does not make launch 0 a current
// market, search control, or release requirement.
const token = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
const recipient = getAddress("0x1111111111111111111111111111111111111111");
const amountIn = 1_000_000_000_000_000n;
const quoteOut = 2_000_000_000_000_000_000n;
const deadline = 2_000_000_000n;

assert.throws(
  () => buildRmtV4Swap({ token, recipient, side: "buy", amountIn: 1n, quoteOut: 1n, deadline }),
  /too small to enforce a safe minimum received/
);

const buy = buildRmtV4Swap({ token, recipient, side: "buy", amountIn, quoteOut, deadline });
assert.match(buy.calldata, /^0x3593564c/);
assert.equal(buy.value, amountIn);
assert.equal(buy.minimumOut, quoteOut * 99n / 100n);
assert.equal(keccak256(buy.calldata), "0xf0e902fc8584dfbbaac5c2fa6b8c550c12c782eb00341bfb0d344a45c4684da2");
const buyRoute = inspectRoute(buy.calldata);
assert.equal(buyRoute.commands, "0x100404");
assert.equal(buyRoute.routeDeadline, deadline);
assert.equal(buyRoute.actions, "0x060b0e");
assert.equal(buyRoute.takeCurrency.toLowerCase(), token.toLowerCase());
assert.equal(buyRoute.takeRecipient.toLowerCase(), ROUTER_AS_RECIPIENT.toLowerCase());
assert.equal(buyRoute.takeAmount, 0n);
assert.equal(buyRoute.sweepCurrency.toLowerCase(), token.toLowerCase());
assert.equal(buyRoute.sweepRecipient.toLowerCase(), recipient.toLowerCase());

const sell = buildRmtV4Swap({ token, recipient, side: "sell", amountIn: quoteOut, quoteOut: amountIn, deadline });
assert.match(sell.calldata, /^0x3593564c/);
assert.equal(sell.value, 0n);
assert.equal(sell.minimumOut, amountIn * 99n / 100n);
assert.equal(keccak256(sell.calldata), "0x0d35ed23d5ff4377770cc62157ef663e0d5f64d2c49d4eb45707be6de7ad1cbf");
const sellRoute = inspectRoute(sell.calldata);
assert.equal(sellRoute.commands, "0x02100404");
assert.equal(sellRoute.routeDeadline, deadline);
assert.equal(sellRoute.actions, "0x060b0e");
assert.equal(sellRoute.takeCurrency, zeroAddress);
assert.equal(sellRoute.takeRecipient.toLowerCase(), ROUTER_AS_RECIPIENT.toLowerCase());
assert.equal(sellRoute.takeAmount, 0n);
assert.equal(sellRoute.sweepCurrency, zeroAddress);
assert.equal(sellRoute.sweepRecipient.toLowerCase(), recipient.toLowerCase());

console.log("RMT V4 buy/sell calldata encoding passed.");
