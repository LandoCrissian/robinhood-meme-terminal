import assert from "node:assert/strict";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import {
  auditSushiSwapCandidate,
  SUSHI_RED_SNWAPPER_CODE_HASH,
  SUSHI_ROUTE_EXECUTOR,
  SUSHI_ROUTE_EXECUTOR_CODE_HASH,
  sushiRedSnwapperAbi
} from "./sushi-swap-validation";
import { SUSHI_RED_SNWAPPER } from "../sushi";
import { quoteAndBuildSushiSwap, quoteSushiRoute, sushiQuotesEnabled } from "./sushi-trade";

const token = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
const recipient = getAddress("0x1111111111111111111111111111111111111111");
const amountIn = 1_000_000_000_000_000n;
const nativeToken = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
const routeAmountOut = 1_831_716n;
const routeMinimumOut = 1_813_398n;

function swapCandidate(overrides: Partial<{
  sender: Address;
  router: Address;
  tokenIn: Address;
  calldataAmountIn: bigint;
  recipient: Address;
  tokenOut: Address;
  minimumOut: bigint;
  executor: Address;
  executorData: Hex;
  value: bigint;
  responseAmountIn: bigint;
  assumedAmountOut: bigint;
  priceImpact: number;
}> = {}) {
  const data = encodeFunctionData({
    abi: sushiRedSnwapperAbi,
    functionName: "snwap",
    args: [
      overrides.tokenIn ?? nativeToken,
      overrides.calldataAmountIn ?? amountIn,
      overrides.recipient ?? recipient,
      overrides.tokenOut ?? token,
      overrides.minimumOut ?? routeMinimumOut,
      overrides.executor ?? SUSHI_ROUTE_EXECUTOR,
      overrides.executorData ?? "0x6be92b8900"
    ]
  });
  return {
    status: "Success",
    amountIn: (overrides.responseAmountIn ?? amountIn).toString(),
    assumedAmountOut: (overrides.assumedAmountOut ?? routeAmountOut).toString(),
    priceImpact: overrides.priceImpact ?? 0.004,
    tokenFrom: 0,
    tokenTo: 1,
    tokens: [
      { address: overrides.tokenIn ?? nativeToken, symbol: "ETH", name: "Ether", decimals: 18 },
      { address: overrides.tokenOut ?? token, symbol: "RMT", name: "Robinhood Meme Terminal", decimals: 18 }
    ],
    tx: {
      from: overrides.sender ?? recipient,
      to: overrides.router ?? SUSHI_RED_SNWAPPER,
      data,
      value: (overrides.value ?? amountIn).toString(),
      gasPrice: 75_570_000
    }
  };
}

const approvedCodeHash = async (address: Address) => {
  if (address.toLowerCase() === SUSHI_RED_SNWAPPER.toLowerCase()) return SUSHI_RED_SNWAPPER_CODE_HASH;
  if (address.toLowerCase() === SUSHI_ROUTE_EXECUTOR.toLowerCase()) return SUSHI_ROUTE_EXECUTOR_CODE_HASH;
  throw new Error("Unexpected contract lookup.");
};

assert.equal(sushiQuotesEnabled({ RMT_SUSHI_QUOTES_ENABLED: "true" }), true);
assert.equal(sushiQuotesEnabled({ RMT_SUSHI_QUOTES_ENABLED: "false" }), false);

async function main() {
  let requestedUrl = "";
  const success = await quoteSushiRoute(
    { token, recipient, side: "buy", amountIn },
    {
      enabled: true,
      chainId: 4663,
      requireTokenMetadata: true,
      fetch: async (input) => {
        requestedUrl = input.toString();
        return Response.json({
          status: "Success",
          amountIn: amountIn.toString(),
          assumedAmountOut: "2500000000000000000",
          priceImpact: 0.004,
          tokenFrom: 0,
          tokenTo: 1,
          tokens: [
            { address: nativeToken, symbol: "ETH", name: "Ether", decimals: 18 },
            { address: token, symbol: "RMT", name: "Robinhood Meme Terminal", decimals: 18 }
          ]
        });
      }
    }
  );

  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://api.sushi.com");
  assert.equal(url.pathname, "/quote/v7/4663");
  assert.equal(url.searchParams.get("tokenIn")?.toLowerCase(), "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  assert.equal(url.searchParams.get("tokenOut")?.toLowerCase(), token.toLowerCase());
  assert.equal(url.searchParams.get("amount"), amountIn.toString());
  assert.equal(url.searchParams.get("maxSlippage"), "0.01");
  assert.equal(success.venue, "sushi-aggregator");
  assert.equal(success.protocol, "SUSHI");
  assert.equal(success.quoteOut, "2500000000000000000");
  assert.equal(success.minimumOut, "2475000000000000000");
  assert.equal(success.priceImpact, 0.004);
  assert.equal(success.executable, false);
  assert.equal(success.verifiedInput, true);
  assert.equal(success.inputToken?.symbol, "ETH");
  assert.equal(success.outputToken?.symbol, "RMT");

  await assert.rejects(
    quoteSushiRoute({ token, recipient, side: "buy", amountIn }, { enabled: false }),
    /not enabled/
  );
  await assert.rejects(
    quoteSushiRoute({ token, recipient, side: "buy", amountIn }, { enabled: true, fetch: async () => Response.json({ status: "NoWay" }) }),
    /does not have a route/
  );
  await assert.rejects(
    quoteSushiRoute({ token, recipient, side: "sell", amountIn }, { enabled: true, fetch: async () => Response.json({ status: "Partial", assumedAmountOut: "1" }) }),
    /complete trade amount/
  );
  await assert.rejects(
    quoteSushiRoute({ token, recipient, side: "buy", amountIn }, { enabled: true, fetch: async () => Response.json({ status: "Success", amountIn: "2", assumedAmountOut: "10", priceImpact: 0 }) }),
    /different input amount/
  );
  await assert.rejects(
    quoteSushiRoute({ token, recipient, side: "buy", amountIn }, { enabled: true, fetch: async () => Response.json({ status: "Success", amountIn: amountIn.toString(), amountOut: "10", priceImpact: 1.2 }) }),
    /invalid price impact/
  );
  await assert.rejects(
    quoteSushiRoute({ token, recipient, side: "buy", amountIn }, { enabled: true, fetch: async () => Response.json({ status: "Success", amountIn: amountIn.toString(), amountOut: "10", priceImpact: "" }) }),
    /invalid price impact/
  );
  await assert.rejects(
    quoteSushiRoute(
      { token, recipient, side: "buy", amountIn },
      {
        enabled: true,
        chainId: 4663,
        requireTokenMetadata: true,
        fetch: async () => Response.json({
          status: "Success",
          amountIn: amountIn.toString(),
          amountOut: "10",
          tokenFrom: 0,
          tokenTo: 1,
          tokens: [
            { address: nativeToken, symbol: "ETH", name: "Ether", decimals: 18 },
            { address: recipient, symbol: "BAD", name: "Wrong token", decimals: 18 }
          ]
        })
      }
    ),
    /different route/
  );
  await assert.rejects(
    quoteSushiRoute(
      { token, recipient, side: "buy", amountIn },
      {
        enabled: true,
        chainId: 4663,
        requireTokenMetadata: true,
        fetch: async () => Response.json({ status: "Success", amountIn: amountIn.toString(), amountOut: "10" })
      }
    ),
    /incomplete token metadata/
  );

  const auditedSwap = await auditSushiSwapCandidate(
    { token, recipient, side: "buy", amountIn },
    swapCandidate(),
    { codeHash: approvedCodeHash }
  );
  assert.equal(auditedSwap.router, SUSHI_RED_SNWAPPER);
  assert.equal(auditedSwap.executor, SUSHI_ROUTE_EXECUTOR);
  assert.equal(auditedSwap.minimumOut, routeMinimumOut);
  assert.equal(auditedSwap.executable, true);
  assert.equal(auditedSwap.onchainDeadline, false);

  let executableUrl = "";
  const executable = await quoteAndBuildSushiSwap(
    { token, recipient, side: "buy", amountIn, maxPriceImpact: 0.1 },
    {
      enabled: true,
      chainId: 4663,
      now: () => 1_000_000,
      codeHash: approvedCodeHash,
      fetch: async (input) => {
        executableUrl = input.toString();
        return Response.json(swapCandidate());
      }
    }
  );
  const executableRequest = new URL(executableUrl);
  assert.equal(executableRequest.pathname, "/swap/v7/4663");
  assert.equal(executableRequest.searchParams.get("sender"), recipient);
  assert.equal(executableRequest.searchParams.get("recipient"), recipient);
  assert.equal(executableRequest.searchParams.get("simulate"), "true");
  assert.equal(executableRequest.searchParams.get("validate"), "true");
  assert.equal(executableRequest.searchParams.get("maxPriceImpact"), "0.1");
  assert.equal(executable.executable, true);
  assert.equal(executable.onchainDeadline, false);
  assert.equal(executable.quoteExpiresAt, "1090");
  assert.equal(executable.router, SUSHI_RED_SNWAPPER);
  assert.equal(executable.minimumOut, routeMinimumOut.toString());
  await assert.rejects(
    quoteAndBuildSushiSwap(
      { token, recipient, side: "buy", amountIn },
      {
        enabled: true,
        chainId: 4663,
        codeHash: approvedCodeHash,
        fetch: async () => Response.json(swapCandidate({ priceImpact: 0.051 }))
      }
    ),
    /selected maximum price impact/
  );

  const auditedSell = await auditSushiSwapCandidate(
    { token, recipient, side: "sell", amountIn },
    swapCandidate({ tokenIn: token, tokenOut: nativeToken, value: 0n }),
    { codeHash: approvedCodeHash }
  );
  assert.equal(auditedSell.tokenIn, token);
  assert.equal(auditedSell.tokenOut, nativeToken);
  assert.equal(auditedSell.value, 0n);
  assert.equal(auditedSell.executable, true);

  const badAddress = getAddress("0x2222222222222222222222222222222222222222");
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ sender: badAddress }), { codeHash: approvedCodeHash }), /transaction sender/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ router: badAddress }), { codeHash: approvedCodeHash }), /execution router/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ tokenIn: badAddress }), { codeHash: approvedCodeHash }), /input token/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ calldataAmountIn: 2n }), { codeHash: approvedCodeHash }), /calldata changed the input amount/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ recipient: badAddress }), { codeHash: approvedCodeHash }), /output recipient/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ tokenOut: badAddress }), { codeHash: approvedCodeHash }), /output token/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ minimumOut: 1n }), { codeHash: approvedCodeHash }), /minimum received/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ executor: badAddress }), { codeHash: approvedCodeHash }), /route executor/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ executorData: "0x1234567800" }), { codeHash: approvedCodeHash }), /executor entrypoint/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ value: 0n }), { codeHash: approvedCodeHash }), /native transaction value/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate({ responseAmountIn: 2n }), { codeHash: approvedCodeHash }), /executable input amount/);
  await assert.rejects(auditSushiSwapCandidate({ token, recipient, side: "buy", amountIn }, swapCandidate(), { codeHash: async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), /router bytecode/);

  console.log("Sushi Robinhood Chain quote, execution, and fail-closed validation passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
