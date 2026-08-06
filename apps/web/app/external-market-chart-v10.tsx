"use client";

import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount } from "wagmi";
import {
  EXTERNAL_CHART_RANGES,
  type ExternalChartRange,
  type ExternalOhlcvCandle
} from "../lib/external-ohlcv";
import {
  POSITION_GUARD_CHANGED_EVENT,
  readPositionGuard,
  type PositionGuard
} from "../lib/position-guard";
import type { ExternalMarketStreamStatus } from "../lib/external-trades";

type ChartMode = "candles" | "line";
type ChartGuardLevel = {
  id: "floor" | "target";
  label: string;
  value: number;
  tone: "floor" | "target";
  location: "visible" | "above" | "below";
};

const CHART_MODE_STORAGE_KEY = "rmt:external-chart-mode";

function price(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value < 0.0001
    ? "$" + value.toLocaleString(undefined, { maximumSignificantDigits: 5 })
    : "$" + value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function compactVolume(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  return value.toLocaleString(undefined, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 2
  });
}

function timeLabel(timestamp: number, range: ExternalChartRange) {
  const date = new Date(timestamp * 1_000);
  return range === "7D"
    ? date.toLocaleDateString([], { month: "short", day: "numeric" })
    : date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: range === "LIVE" ? "2-digit" : undefined
      });
}

function freshness(lastTradeAt?: string | null, updatedAt?: string) {
  const timestamp = lastTradeAt ? Date.parse(lastTradeAt) : Number.NaN;
  if (Number.isFinite(timestamp)) {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
    if (seconds < 10) return { label: "LIVE · JUST CONFIRMED", active: true };
    if (seconds < 60) return { label: `LIVE · ${seconds}S AGO`, active: true };
    if (seconds < 3_600) return { label: `LAST SWAP · ${Math.floor(seconds / 60)}M AGO`, active: false };
    return { label: `LAST SWAP · ${Math.floor(seconds / 3_600)}H AGO`, active: false };
  }
  const updated = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return {
    label: Number.isFinite(updated) ? "POOL SNAPSHOT" : "SYNCING",
    active: false
  };
}

function nextProfitTarget(guard: PositionGuard) {
  if (guard.entryPriceUsd === null) return null;
  if (
    guard.recoverPrincipal
    && !guard.principalRecovered
    && !guard.handledProfitTargets.includes("principal-2x")
  ) return { label: "PRINCIPAL · 2×", value: guard.entryPriceUsd * 2 };
  if (guard.stagedProfitLock && !guard.handledProfitTargets.includes("bank-3x")) {
    return { label: "BANK 25% · 3×", value: guard.entryPriceUsd * 3 };
  }
  if (guard.stagedProfitLock && !guard.handledProfitTargets.includes("bank-5x")) {
    return { label: "BANK 20% · 5×", value: guard.entryPriceUsd * 5 };
  }
  return null;
}

function levelLocation(value: number, minimum: number, maximum: number): ChartGuardLevel["location"] {
  if (value > maximum) return "above";
  if (value < minimum) return "below";
  return "visible";
}

function locationLabel(location: ChartGuardLevel["location"]) {
  if (location === "above") return "ABOVE RANGE ↑";
  if (location === "below") return "BELOW RANGE ↓";
  return "ON CHART";
}

export function ExternalMarketChartV10({
  candles,
  range,
  loading,
  stale,
  error,
  updatedAt,
  lastTradeAt,
  feedStatus,
  onRangeChange
}: {
  candles: ExternalOhlcvCandle[];
  range: ExternalChartRange;
  loading: boolean;
  stale?: boolean;
  error?: string;
  updatedAt?: string;
  lastTradeAt?: string | null;
  feedStatus?: ExternalMarketStreamStatus;
  onRangeChange: (range: ExternalChartRange) => void;
}) {
  const gradientId = useId().replaceAll(":", "");
  const params = useParams<{ address: string }>();
  const { address: wallet } = useAccount();
  const token = useMemo(
    () => params.address && isAddress(params.address) ? getAddress(params.address) : null,
    [params.address]
  );
  const [guard, setGuard] = useState<PositionGuard | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!wallet || !token) {
      setGuard(null);
      return;
    }
    const sync = () => setGuard(readPositionGuard(wallet, token));
    const onGuardChange = (event: Event) => {
      const detail = (event as CustomEvent<{ wallet?: string; token?: string }>).detail;
      if (
        detail?.wallet && detail?.token
        && (detail.wallet.toLowerCase() !== wallet.toLowerCase() || detail.token.toLowerCase() !== token.toLowerCase())
      ) return;
      sync();
    };
    sync();
    window.addEventListener(POSITION_GUARD_CHANGED_EVENT, onGuardChange);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(POSITION_GUARD_CHANGED_EVENT, onGuardChange);
      window.removeEventListener("storage", sync);
    };
  }, [token, wallet]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CHART_MODE_STORAGE_KEY);
      if (saved === "candles" || saved === "line") setChartMode(saved);
    } catch {
      // A blocked preference store does not prevent charting.
    }
  }, []);

  useEffect(() => setHoveredIndex(null), [candles, range]);

  const changeChartMode = (mode: ChartMode) => {
    setChartMode(mode);
    setHoveredIndex(null);
    try {
      window.localStorage.setItem(CHART_MODE_STORAGE_KEY, mode);
    } catch {
      // The selected mode still applies for the current session.
    }
  };

  const width = 760;
  const height = 300;
  const paddingX = 14;
  const priceTop = 18;
  const priceBottom = 218;
  const volumeTop = 238;
  const volumeBottom = 282;
  const closes = candles.map((candle) => candle.close);
  const priceValues = candles.flatMap((candle) => [candle.low, candle.high]);
  const rawMinimum = priceValues.length ? Math.min(...priceValues) : 0;
  const rawMaximum = priceValues.length ? Math.max(...priceValues) : 0;
  const padding = rawMaximum > rawMinimum ? (rawMaximum - rawMinimum) * 0.04 : rawMaximum * 0.01;
  const minimum = Math.max(0, rawMinimum - padding);
  const maximum = rawMaximum + padding;
  const rangeValue = maximum - minimum || maximum * 0.02 || 1;
  const maximumVolume = Math.max(...candles.map((candle) => candle.volume), 1);
  const usableWidth = width - paddingX * 2;
  const priceY = (value: number) => priceTop + (1 - (value - minimum) / rangeValue) * (priceBottom - priceTop);
  const coordinates = candles.map((candle, index) => ({
    x: paddingX + (index / Math.max(candles.length - 1, 1)) * usableWidth,
    y: priceY(candle.close)
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
  const volumeBarWidth = Math.max(1.5, usableWidth / Math.max(candles.length, 1) - 1.5);
  const candleWidth = Math.max(2.2, Math.min(10, usableWidth / Math.max(candles.length, 1) * 0.68));
  const feed = freshness(lastTradeAt, updatedAt);
  const streamFeed = range !== "LIVE" || !feedStatus
    ? feed
    : feedStatus === "live"
      ? { label: "CONFIRMED STREAM LIVE", active: true }
      : feedStatus === "fallback"
        ? { label: "LIVE FALLBACK ACTIVE", active: true }
        : feedStatus === "connecting"
          ? { label: "OPENING LIVE STREAM", active: false }
          : { label: "STREAM RECONNECTING", active: false };
  const latestPoint = coordinates.at(-1);
  const hoveredCandle = hoveredIndex === null ? undefined : candles[hoveredIndex];
  const hoveredPoint = hoveredIndex === null ? undefined : coordinates[hoveredIndex];

  const chartGuardLevels = useMemo<ChartGuardLevel[]>(() => {
    if (
      candles.length < 2 || !guard?.enabled || latest <= 0
      || guard.entryPriceUsd === null || guard.highWatermarkPriceUsd === null
      || !Number.isFinite(minimum) || !Number.isFinite(maximum)
    ) return [];
    const highWatermark = Math.max(guard.highWatermarkPriceUsd, latest);
    const staticFloor = guard.entryPriceUsd * (1 - guard.stopLossBps / 10_000);
    const trailingFloor = highWatermark * (1 - guard.trailingStopBps / 10_000);
    const breakEvenArmed = highWatermark >= guard.entryPriceUsd * (1 + guard.breakEvenActivationBps / 10_000);
    const effectiveFloor = Math.max(staticFloor, trailingFloor, breakEvenArmed ? guard.entryPriceUsd : 0);
    const nextTarget = nextProfitTarget(guard);
    return [
      {
        id: "floor",
        label: guard.triggeredAt ? "EXIT FLOOR TRIGGERED" : "POSITION FLOOR",
        value: effectiveFloor,
        tone: "floor",
        location: levelLocation(effectiveFloor, minimum, maximum)
      },
      ...(nextTarget ? [{
        id: "target" as const,
        label: nextTarget.label,
        value: nextTarget.value,
        tone: "target" as const,
        location: levelLocation(nextTarget.value, minimum, maximum)
      }] : [])
    ];
  }, [candles.length, guard, latest, maximum, minimum]);

  return (
    <section className="universalChart" aria-labelledby="universal-chart-title">
      <header>
        <div>
          <small>CONFIRMED POOL PRICE</small>
          <strong id="universal-chart-title" aria-live="polite">{price(latest)}</strong>
          <span className={positive ? "positive" : "negative"}>
            {positive ? "+" : ""}{change.toLocaleString(undefined, { maximumFractionDigits: 2 })}% · {range}
          </span>
        </div>
        <div className="universalChartControls">
          <span className={`universalChartFeed ${streamFeed.active ? "active" : "quiet"}${stale ? " stale" : ""}`}>
            <i aria-hidden="true" />{stale ? "FEED RETRYING" : streamFeed.label}
          </span>
          <div className="universalChartModes" role="group" aria-label="Chart display mode">
            <button type="button" className={chartMode === "candles" ? "active" : ""} aria-pressed={chartMode === "candles"} onClick={() => changeChartMode("candles")}>Candles</button>
            <button type="button" className={chartMode === "line" ? "active" : ""} aria-pressed={chartMode === "line"} onClick={() => changeChartMode("line")}>Line</button>
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
        </div>
      </header>

      {chartGuardLevels.length > 0 && (
        <div className="universalChartGuardSummary" aria-label="Position Guard chart levels">
          {chartGuardLevels.map((level) => (
            <span className={level.tone} key={level.id}>
              <small>{level.label}</small>
              <strong>{price(level.value)}</strong>
              <em>{locationLabel(level.location)}</em>
            </span>
          ))}
        </div>
      )}

      {hoveredCandle && hoveredIndex !== null && (
        <div className={`universalChartTooltip ${hoveredIndex > candles.length / 2 ? "left" : "right"}`} role="status">
          <span>{timeLabel(hoveredCandle.timestamp, range)} · {chartMode.toUpperCase()}</span>
          <dl>
            <div><dt>Open</dt><dd>{price(hoveredCandle.open)}</dd></div>
            <div><dt>High</dt><dd>{price(hoveredCandle.high)}</dd></div>
            <div><dt>Low</dt><dd>{price(hoveredCandle.low)}</dd></div>
            <div><dt>Close</dt><dd>{price(hoveredCandle.close)}</dd></div>
            <div><dt>Volume</dt><dd>{compactVolume(hoveredCandle.volume)}</dd></div>
          </dl>
        </div>
      )}

      {candles.length >= 2 ? (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${range} ${chartMode} price and volume chart`}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const chartX = (event.clientX - rect.left) / Math.max(rect.width, 1) * width;
              const index = Math.max(0, Math.min(
                candles.length - 1,
                Math.round((chartX - paddingX) / Math.max(usableWidth, 1) * Math.max(candles.length - 1, 1))
              ));
              setHoveredIndex(index);
            }}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={positive ? "#66ef7c" : "#ff7777"} stopOpacity=".28" />
                <stop offset="100%" stopColor={positive ? "#66ef7c" : "#ff7777"} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3].map((row) => {
              const y = priceTop + row / 3 * (priceBottom - priceTop);
              return <line x1={paddingX} x2={width - paddingX} y1={y} y2={y} className="chartGridLine" key={row} />;
            })}
            {chartGuardLevels.filter((level) => level.location === "visible").map((level) => {
              const y = priceY(level.value);
              return (
                <g className={`chartGuardLevel ${level.tone}`} key={level.id} aria-hidden="true">
                  <line x1={paddingX} x2={width - paddingX} y1={y} y2={y} />
                  <rect x={width - 162} y={y - 12} width="148" height="22" rx="5" />
                  <text x={width - 22} y={y + 4} textAnchor="end">{level.label} · {price(level.value)}</text>
                </g>
              );
            })}
            {chartMode === "line" ? <>
              <path d={areaPath} fill={`url(#${gradientId})`} />
              <path d={linePath} className={positive ? "chartLine positive" : "chartLine negative"} />
            </> : candles.map((candle, index) => {
              const point = coordinates[index];
              const openY = priceY(candle.open);
              const closeY = priceY(candle.close);
              const highY = priceY(candle.high);
              const lowY = priceY(candle.low);
              const bodyY = Math.min(openY, closeY);
              const bodyHeight = Math.max(1, Math.abs(closeY - openY));
              const rising = candle.close >= candle.open;
              return (
                <g className={`chartCandle ${rising ? "buy" : "sell"}`} key={`candle:${candle.timestamp}`}>
                  <line x1={point.x} x2={point.x} y1={highY} y2={lowY} />
                  <rect x={point.x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} rx=".7" />
                </g>
              );
            })}
            {candles.map((candle, index) => {
              const point = coordinates[index];
              const barHeight = Math.max(1, candle.volume / maximumVolume * (volumeBottom - volumeTop));
              return (
                <rect
                  key={`volume:${candle.timestamp}`}
                  x={point.x - volumeBarWidth / 2}
                  y={volumeBottom - barHeight}
                  width={volumeBarWidth}
                  height={barHeight}
                  className={candle.close >= candle.open ? "volumeBar buy" : "volumeBar sell"}
                />
              );
            })}
            {hoveredPoint && (
              <g className="chartHoverCrosshair" aria-hidden="true">
                <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={priceTop} y2={volumeBottom} />
                <line x1={paddingX} x2={width - paddingX} y1={hoveredPoint.y} y2={hoveredPoint.y} />
                <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="3.5" />
              </g>
            )}
            {latestPoint && (
              <g className={streamFeed.active ? "chartLatest active" : "chartLatest"}>
                <line x1={latestPoint.x} x2={latestPoint.x} y1={priceTop} y2={volumeBottom} />
                <circle cx={latestPoint.x} cy={latestPoint.y} r="4.5" />
              </g>
            )}
          </svg>
          <div className="universalChartAxis">
            <span>{timeLabel(candles[0].timestamp, range)}</span>
            <span>{chartMode === "candles" ? "OHLC CANDLES" : "CLOSE-PRICE LINE"} · {range === "LIVE" ? "CONFIRMED SWAPS" : "AUTO REFRESH"}</span>
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
