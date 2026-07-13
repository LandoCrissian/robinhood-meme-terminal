"use client";

import { formatEther } from "viem";
import { isMainnetRelease } from "../lib/network";

export type PricePoint = {
  blockNumber: bigint;
  priceWei: bigint;
  side: "buy" | "sell";
};

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value < 0.000001) return value.toExponential(4);
  return value.toLocaleString(undefined, { maximumFractionDigits: 9 });
}

export function PriceHistoryChart({ points, symbol }: { points: PricePoint[]; symbol: string }) {
  if (points.length < 2) {
    return (
      <div className="priceChart emptyPriceChart">
        <div>
          <p className="eyebrow">ONCHAIN PRICE</p>
          <h3>Price history</h3>
        </div>
        <p>Two confirmed trades will create the first live chart.</p>
      </div>
    );
  }

  const width = 720;
  const height = 210;
  const paddingX = 12;
  const paddingY = 18;
  const prices = points.map((point) => Number(formatEther(point.priceWei)));
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const range = maximum - minimum || maximum * 0.02 || 1;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const coordinates = prices.map((price, index) => ({
    x: paddingX + (index / (prices.length - 1)) * usableWidth,
    y: paddingY + (1 - (price - minimum) / range) * usableHeight
  }));
  const linePath = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${coordinates.at(-1)?.x.toFixed(2)} ${height - paddingY} L ${coordinates[0]?.x.toFixed(2)} ${height - paddingY} Z`;
  const latest = prices.at(-1) ?? 0;
  const first = prices[0] ?? latest;
  const change = first > 0 ? ((latest - first) / first) * 100 : 0;
  const isPositive = change >= 0;

  return (
    <div className="priceChart">
      <div className="priceChartHeader">
        <div>
          <p className="eyebrow">ONCHAIN PRICE</p>
          <h3>{formatPrice(latest)} {isMainnetRelease ? "ETH" : "test ETH"}</h3>
          <small>per {symbol}</small>
        </div>
        <span className={isPositive ? "priceChange positive" : "priceChange negative"}>
          {isPositive ? "+" : ""}{change.toFixed(2)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} onchain price history across ${points.length} recent trades`}>
        <defs>
          <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#48ed6d" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#48ed6d" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#priceArea)" />
        <path d={linePath} fill="none" stroke="#48ed6d" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {coordinates.map((point, index) => (
          <circle
            key={points[index]?.blockNumber.toString()}
            cx={point.x}
            cy={point.y}
            r={index === coordinates.length - 1 ? 5 : 3}
            className={points[index]?.side === "buy" ? "chartBuyPoint" : "chartSellPoint"}
          />
        ))}
      </svg>
      <div className="chartRange">
        <span>Block {points[0]?.blockNumber.toString()}</span>
        <span>{points.length} confirmed trades</span>
        <span>Block {points.at(-1)?.blockNumber.toString()}</span>
      </div>
    </div>
  );
}
