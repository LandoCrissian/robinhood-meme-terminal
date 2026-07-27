"use client";

import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import type { ExternalMarket } from "../lib/external-market";
import type { SushiIndicativeQuote } from "../lib/sushi";
import { WalletButton } from "./wallet-button";

const ROBINHOOD_CHAIN_ID = 4663;

type ExternalSushiQuote = SushiIndicativeQuote & {
  marketPair: Address;
  marketVerified: true;
};

function cleanDecimal(value: string) {
  const normalized = value.replace(/[^\d.]/g, "");
  const [whole = "", ...fraction] = normalized.split(".");
  return fraction.length > 0 ? `${whole}.${fraction.join("")}` : whole;
}

function displayUnits(value: string, decimals: number, maximumFractionDigits = 6) {
  const formatted = formatUnits(BigInt(value), decimals);
  const numeric = Number(formatted);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits })
    : formatted;
}

export function ExternalSushiQuotePanel({
  market,
  side
}: {
  market: ExternalMarket;
  side: "buy" | "sell";
}) {
  const { address, chainId } = useAccount();
  const [amount, setAmount] = useState(side === "buy" ? "0.0001" : "");
  const [quote, setQuote] = useState<ExternalSushiQuote>();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const token = market.address as Address;
  const pair = market.pairAddress as Address;
  const tokenDecimals = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_ID,
    query: { retry: false }
  });
  const tokenBalance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: Boolean(address), retry: false, refetchInterval: 15_000 }
  });
  const decimals = tokenDecimals.data;

  const amountIn = useMemo(() => {
    if (!amount || !address) return 0n;
    try {
      if (side === "buy") return parseEther(amount);
      if (decimals === undefined) return 0n;
      return parseUnits(amount, decimals);
    } catch {
      return 0n;
    }
  }, [address, amount, decimals, side]);

  useEffect(() => {
    setAmount(side === "buy" ? "0.0001" : "");
    setQuote(undefined);
    setError("");
    setStatus("idle");
  }, [market.address, side]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefresh((value) => value + 1), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setQuote(undefined);
    setError("");
    if (!address || amountIn <= 0n || (side === "sell" && decimals === undefined)) {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void fetch("/api/trade/external-sushi-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          pair,
          recipient: address,
          side,
          amountIn: amountIn.toString()
        }),
        signal: controller.signal
      }).then(async (response) => {
        const payload = await response.json() as ExternalSushiQuote | { error?: string };
        if (!response.ok) throw new Error("error" in payload ? payload.error : "Sushi quote is unavailable.");
        if (
          !("marketVerified" in payload)
          || payload.marketVerified !== true
          || payload.verifiedInput !== true
          || payload.executable !== false
          || payload.venue !== "sushi-aggregator"
          || payload.chainId !== ROBINHOOD_CHAIN_ID
          || payload.token.toLowerCase() !== token.toLowerCase()
          || payload.recipient.toLowerCase() !== address.toLowerCase()
          || payload.marketPair.toLowerCase() !== pair.toLowerCase()
          || payload.side !== side
          || payload.amountIn !== amountIn.toString()
          || !payload.inputToken
          || !payload.outputToken
        ) {
          throw new Error("RMT rejected an inconsistent Sushi quote.");
        }
        setQuote(payload);
        setStatus("idle");
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Sushi quote is unavailable.");
      });
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, amountIn, decimals, pair, refresh, side, token]);

  const setSellFraction = (basisPoints: bigint) => {
    if (tokenBalance.data === undefined || decimals === undefined) return;
    const selected = tokenBalance.data * basisPoints / 10_000n;
    setAmount(formatUnits(selected, decimals));
  };
  const outputDecimals = quote?.outputToken?.decimals;
  const outputSymbol = quote?.outputToken?.symbol ?? (side === "buy" ? market.symbol : "ETH");

  return (
    <section className="externalSushiQuote" aria-labelledby="external-sushi-quote-heading">
      <header>
        <div>
          <small>VERIFIED SUSHI ROUTE</small>
          <strong id="external-sushi-quote-heading">Fresh quote inside RMT</strong>
        </div>
        <span>1% max slippage</span>
      </header>

      {!address ? (
        <div className="externalSushiConnect">
          <p>Connect a wallet to calculate a route for your exact trade. RMT never takes custody.</p>
          <WalletButton target="mainnet" showFunding={false} />
        </div>
      ) : (
        <>
          <label className="externalSushiAmount">
            <span>
              <small>You {side === "buy" ? "pay" : "sell"}</small>
              {side === "sell" && (
                <em>
                  Balance {tokenBalance.data !== undefined && decimals !== undefined
                    ? displayUnits(tokenBalance.data.toString(), decimals, 4)
                    : "—"} {market.symbol}
                </em>
              )}
            </span>
            <div>
              <input
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                placeholder="0.0"
                aria-label={`${side === "buy" ? "ETH" : market.symbol} amount`}
                onChange={(event) => setAmount(cleanDecimal(event.target.value))}
              />
              <strong>{side === "buy" ? "ETH" : market.symbol}</strong>
            </div>
          </label>
          <div className="externalSushiPresets" aria-label="Amount shortcuts">
            {side === "buy" ? (
              <>
                <button type="button" onClick={() => setAmount("0.0001")}>0.0001 ETH</button>
                <button type="button" onClick={() => setAmount("0.0005")}>0.0005 ETH</button>
                <button type="button" onClick={() => setAmount("0.001")}>0.001 ETH</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSellFraction(2_500n)}>25%</button>
                <button type="button" onClick={() => setSellFraction(5_000n)}>50%</button>
                <button type="button" onClick={() => setSellFraction(10_000n)}>Max</button>
              </>
            )}
          </div>

          {chainId !== ROBINHOOD_CHAIN_ID && (
            <div className="externalSushiNetwork">
              <WalletButton target="mainnet" showFunding={false} />
            </div>
          )}

          <div className="externalSushiResult" aria-live="polite">
            <div>
              <span>Estimated receive</span>
              <strong>
                {status === "loading"
                  ? "Checking route…"
                  : quote && outputDecimals !== undefined
                    ? `${displayUnits(quote.quoteOut, outputDecimals)} ${outputSymbol}`
                    : "Enter an amount"}
              </strong>
            </div>
            {quote && outputDecimals !== undefined && (
              <dl>
                <div><dt>Minimum received</dt><dd>{displayUnits(quote.minimumOut, outputDecimals)} {outputSymbol}</dd></div>
                <div><dt>Price impact</dt><dd>{(quote.priceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</dd></div>
                <div><dt>Market check</dt><dd>Pool + token matched</dd></div>
              </dl>
            )}
            {status === "error" && <p role="alert">{error}</p>}
          </div>
        </>
      )}

      <p className="externalSushiSafety">
        RMT verifies this pool and quote but intentionally does not forward Sushi calldata yet:
        the current Robinhood Chain router has no onchain deadline. Final execution stays on Sushi until that protection exists.
      </p>
    </section>
  );
}
