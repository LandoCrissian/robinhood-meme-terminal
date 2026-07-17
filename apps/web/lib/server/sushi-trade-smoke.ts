import assert from "node:assert/strict";
import { getAddress } from "viem";
import { quoteSushiRoute, sushiQuotesEnabled } from "./sushi-trade";

const token = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
const recipient = getAddress("0x1111111111111111111111111111111111111111");
const amountIn = 1_000_000_000_000_000n;

assert.equal(sushiQuotesEnabled({ RMT_SUSHI_QUOTES_ENABLED: "true" }), true);
assert.equal(sushiQuotesEnabled({ RMT_SUSHI_QUOTES_ENABLED: "false" }), false);

async function main() {
  let requestedUrl = "";
  const success = await quoteSushiRoute(
    { token, recipient, side: "buy", amountIn },
    {
      enabled: true,
      fetch: async (input) => {
        requestedUrl = input.toString();
        return Response.json({
          status: "Success",
          amountIn: amountIn.toString(),
          assumedAmountOut: "2500000000000000000",
          priceImpact: 0.004
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

  console.log("Sushi Robinhood Chain quote adapter validation passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
