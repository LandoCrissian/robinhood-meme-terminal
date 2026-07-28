"use client";

import { useId } from "react";
import {
  EXTERNAL_CHART_RANGES,
  type ExternalChartRange,
  type ExternalOhlcvCandle
} from "../lib/external-ohlcv";

function price(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value < 0.0001
    ? "$" + value.toLocaleString(undefined, { maximumSignificantDigits: 5 })
    : "$" + value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function timeLabel(timestamp: number, range: ExternalChartRange) {
  const date = new Date(timestamp * 1_000);
  return range === "7D"
    ? date.toLocaleDateString([], { month: "short", day: "numeric" })
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ExternalMarketChart({
  candles,
  range,
  loading,
  error,
  onRangeChange
}: {
  candles: ExternalOhlcvCandle[];
  range: ExternalChartRange;
  loading: boolean;
  error?: string;
  onRangeChange: (range: ExternalChartRange) => void;
}) {
  const gradientId = useId().replaceAll(":", "");
  const width = 760;
  const height = 300;
  const paddingX = 14;
  const priceTop = 18;
  const priceBottom = 218;
  const volumeTop = 238;
  const volumeBottom = 282;
  const closes = candles.map((candle) => candle.close);
  const minimum = Math.min(...closes);
  const maximum = Math.max(...closes);
  const rangeValue = maximum - minimum || maximum * 0.02 || 1;
  const maximumVolume = Math.max(...candles.map((candle) => candle.volume), 1);
  const usableWidth = width - paddingX * 2;
  const coordinates = candles.map((candle, index) => ({
    x: paddingX + (index / Math.max(candles.length - 1, 1)) * usableWidth,
    y: priceTop + (1 - (candle.close - minimum) / rangeValue) * (priceBottom - priceTop)
  }));
  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = coordinates.length > 1
    ? `${linePath} L ${coordinates.at(-1)?.x.toFixed(2)} ${priceBottom} L ${coordinates[0].x.toFixed(2)} ${priceBottom} Z`
    : "";
  const first = closes[0] ?? 0;
  const latest = closes.at(-1) ?? 0;
  const change = first > 0 ? ((latest - first) / first) * 100 : 0;
  const positive = change >= 0;
  const barWidth = Math.max(1.5, usableWidth / Math.max(candles.length, 1) - 1.5);

  return (
    <section className="universalChart" aria-labelledby="universal-chart-title">
      <header>
        <div>
          <small>LIVE USD PRICE</small>
          <strong id="universal-chart-title">{price(latest)}</strong>
          <span className={positive ? "positive" : "negative"}>
            {positive ? "+" : ""}{change.toLocaleString(undefined, { maximumFractionDigits: 2 })}% · {range}
          </span>
        </div>
        <div className="universalChartRanges" role="tablist" aria-label="Chart range">
          {EXTERNAL_CHART_RANGES.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={range === item}
              className={range === item ? "active" : ""}
              onClick={() => onRangeChange(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
      </header>

      {candles.length >= 2 ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${range} price and volume chart`}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={positive ? "#66ef7c" : "#ff7777"} stopOpacity=".28" />
                <stop offset="100%" stopColor={positive ? "#66ef7c" : "#ff7777"} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path d={linePath} className={positive ? "chartLine positive" : "chartLine negative"} />
            {candles.map((candle, index) => {
              const point = coordinates[index];
              const barHeight = Math.max(1, candle.volume / maximumVolume * (volumeBottom - volumeTop));
              return (
                <rect
                  key={candle.timestamp}
                  x={point.x - barWidth / 2}
                  y={volumeBottom - barHeight}
                  width={barWidth}
                  height={barHeight}
                  className={candle.close >= candle.open ? "volumeBar buy" : "volumeBar sell"}
                />
              );
            })}
          </svg>
          <div className="universalChartAxis">
            <span>{timeLabel(candles[0].timestamp, range)}</span>
            <span>VOL</span>
            <span>{timeLabel(candles.at(-1)?.timestamp ?? 0, range)}</span>
          </div>
        </>
      ) : (
        <div className="universalChartState" role="status">
          <strong>{loading ? "Loading live chart…" : "Chart temporarily unavailable"}</strong>
          <span>{loading ? "Reading verified pool OHLCV data." : error ?? "Use the market-source link for the venue chart."}</span>
        </div>
      )}
    </section>
  );
}
