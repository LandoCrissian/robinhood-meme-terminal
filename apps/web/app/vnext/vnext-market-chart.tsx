"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  EXTERNAL_CHART_RANGES,
  externalChartRefreshMs,
  hasCatastrophicOhlcvPriceMismatch,
  type ExternalChartRange,
  type ExternalOhlcvCandle,
  type ExternalOhlcvPayload
} from "../../lib/external-ohlcv";
import { chartComposition } from "../../lib/vnext/chart-composition";
import { TerminalIcon } from "./terminal-icon";
import { useVisibilityRefresh } from "./use-visibility-refresh";

type ChartMode = "candles" | "line";
type ChartStatus = "loading" | "ready" | "stale" | "unavailable" | "empty";

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1) return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`;
}

function formatVolume(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

function timeLabel(timestamp: number, range: ExternalChartRange) {
  const date = new Date(timestamp * 1_000);
  return range === "7D"
    ? date.toLocaleDateString([], { month: "short", day: "numeric" })
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function acceptPayload(value: unknown, token: string, range: ExternalChartRange, referencePriceUsd: number | null) {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<ExternalOhlcvPayload>;
  if (
    payload.token?.toLowerCase() !== token.toLowerCase()
    || typeof payload.pair !== "string"
    || payload.range !== range
    || payload.source !== "GeckoTerminal"
    || !Array.isArray(payload.candles)
    || (payload.candles.length < 1 && payload.coverage !== "NO_HISTORY")
  ) return null;
  if (hasCatastrophicOhlcvPriceMismatch(payload.candles as ExternalOhlcvCandle[], referencePriceUsd)) return null;
  return payload as ExternalOhlcvPayload;
}

function payloadSignature(payload: ExternalOhlcvPayload) {
  const latest = payload.candles.at(-1);
  return `${payload.range}:${payload.candles.length}:${latest?.timestamp}:${latest?.close}:${latest?.volume}:${payload.updatedAt}:${payload.stale}`;
}

function sparseHistoryLabel(range: ExternalChartRange) {
  const labels: Record<ExternalChartRange, string> = {
    "5M": "5-minute",
    "15M": "15-minute",
    "1H": "1-hour",
    "6H": "6-hour",
    "24H": "24-hour",
    "7D": "7-day"
  };
  return `Sparse ${labels[range]} market history`;
}

export function VNextMarketChart({ token, pair, symbol, referencePriceUsd }: {
  token: string;
  pair: string | null;
  symbol: string;
  referencePriceUsd: number | null;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 920, height: 300 });
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const gradientId = useId().replaceAll(":", "");
  const [range, setRange] = useState<ExternalChartRange>("1H");
  const [mode, setMode] = useState<ChartMode>("candles");
  const [payload, setPayload] = useState<ExternalOhlcvPayload>();
  const [status, setStatus] = useState<ChartStatus>("loading");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const signature = useRef("");
  const requestId = useRef(0);
  const chartKey = `${token.toLowerCase()}:${range}`;
  const activeKey = useRef("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("rmt:vnext-chart-mode");
      if (saved === "candles" || saved === "line") setMode(saved);
    } catch {
      // The chart still works when browser storage is unavailable.
    }
  }, []);

  const load = async (quiet: boolean) => {
    const id = ++requestId.current;
    if (!quiet || activeKey.current !== chartKey) {
      activeKey.current = chartKey;
      signature.current = "";
      setPayload(undefined);
      setStatus("loading");
      setHoveredIndex(null);
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_500);
    try {
      const query = new URLSearchParams({ token, range });
      if (pair) query.set("pair", pair);
      if (referencePriceUsd !== null && Number.isFinite(referencePriceUsd) && referencePriceUsd > 0) {
        query.set("referencePrice", String(referencePriceUsd));
      }
      const response = await fetch(`/api/markets/ohlcv?${query}`, { signal: controller.signal });
      const next = acceptPayload(await response.json(), token, range, referencePriceUsd);
      if (!response.ok || !next) throw new Error("Chart response unavailable.");
      if (id !== requestId.current) return;
      const nextSignature = payloadSignature(next);
      if (signature.current !== nextSignature) {
        signature.current = nextSignature;
        setPayload(next);
      }
      setStatus(next.stale ? "stale" : next.coverage === "NO_HISTORY" ? "empty" : "ready");
    } catch {
      if (id !== requestId.current) return;
      setStatus(signature.current ? "stale" : "unavailable");
    } finally {
      window.clearTimeout(timeout);
    }
  };

  useVisibilityRefresh(() => load(true), externalChartRefreshMs(range), { refreshKey: chartKey });

  useEffect(() => () => {
    requestId.current += 1;
  }, [chartKey]);

  const candles = payload?.token.toLowerCase() === token.toLowerCase()
    && payload.range === range
    ? payload.candles : [];
  const sparse = candles.length > 0 && candles.length < 3;
  const geometry = useMemo(() => chartComposition(candles, size.width, size.height), [candles, size]);

  const first = candles[0]?.open ?? 0;
  const latest = candles.at(-1)?.close ?? 0;
  const change = first > 0 ? (latest - first) / first * 100 : 0;
  const positive = change >= 0;
  const hovered = hoveredIndex === null ? undefined : candles[hoveredIndex];
  const hoveredPoint = hoveredIndex === null ? undefined : geometry.points[hoveredIndex];
  const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  const latestPoint = geometry.points.at(-1);
  const candleWidth = Math.max(2.5, Math.min(11, geometry.usableWidth / Math.max(candles.length, 1) * 0.66));
  const volumeWidth = Math.max(2, Math.min(11, geometry.usableWidth / Math.max(candles.length, 1) - 1.5));

  const changeMode = (next: ChartMode) => {
    setMode(next);
    try {
      window.localStorage.setItem("rmt:vnext-chart-mode", next);
    } catch {
      // The visible selection still applies for this session.
    }
  };

  return (
    <section className="vnChart" aria-labelledby="vn-chart-title">
      <header className="vnChartHeader">
        <div className="vnChartHeadline">
          <span className="vnEyebrow">Price Chart</span>
          <div><strong id="vn-chart-title">{formatPrice(hovered?.close ?? referencePriceUsd ?? latest)}</strong><span className={positive ? "vnPositive" : "vnNegative"}>{candles.length ? `${positive ? "+" : "−"}${Math.abs(change).toFixed(2)}%` : "—"} · {range}</span></div>
          <small>{hovered ? timeLabel(hovered.timestamp, range) : symbol} · {status === "stale" ? "Market data delayed" : sparse ? sparseHistoryLabel(range) : "Price history"}</small>
        </div>
        <div className="vnChartControls">
          <div className="vnChartModes" role="group" aria-label="Chart display">
            <button type="button" aria-pressed={mode === "candles"} className={mode === "candles" ? "isActive" : ""} onClick={() => changeMode("candles")}>Candles</button>
            <button type="button" aria-pressed={mode === "line"} className={mode === "line" ? "isActive" : ""} onClick={() => changeMode("line")}>Line</button>
          </div>
          <details className="vnChartStyle"><summary aria-label="Chart style" title="Chart style"><TerminalIcon name="chart" /></summary><div><button type="button" aria-pressed={mode === "candles"} onClick={() => changeMode("candles")}>Candles</button><button type="button" aria-pressed={mode === "line"} onClick={() => changeMode("line")}>Line</button></div></details>
          <span className={`vnChartState is${status}`} role="status"><i aria-hidden="true" />{status === "loading" || status === "ready" ? "Market data" : status === "stale" ? "Market data delayed" : status === "empty" ? "No history" : "Unavailable"}</span>
        </div>
      </header>
      <div className="vnChartRanges" role="tablist" aria-label="Price chart range">
        {EXTERNAL_CHART_RANGES.map((item) => <button type="button" role="tab" aria-selected={range === item} className={range === item ? "isActive" : ""} onClick={() => setRange(item)} key={item}>{item}</button>)}
      </div>
      <div className="vnChartFrame" ref={frame}>
        {hovered && hoveredPoint && <div className={`vnChartTooltip${hoveredIndex !== null && hoveredIndex > candles.length / 2 ? " isLeft" : ""}`}>
          <span>{timeLabel(hovered.timestamp, range)}</span>
          <dl><div><dt>O</dt><dd>{formatPrice(hovered.open)}</dd></div><div><dt>H</dt><dd>{formatPrice(hovered.high)}</dd></div><div><dt>L</dt><dd>{formatPrice(hovered.low)}</dd></div><div><dt>C</dt><dd>{formatPrice(hovered.close)}</dd></div><div><dt>Vol</dt><dd>{formatVolume(hovered.volume)}</dd></div></dl>
        </div>}
        {candles.length >= 1 ? <svg
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img"
          aria-label={`${symbol} ${range} ${mode} chart with volume`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const pointerX = (event.clientX - rect.left) / Math.max(rect.width, 1) * geometry.width;
            setHoveredIndex(Math.max(0, Math.min(candles.length - 1, Math.floor((pointerX - geometry.left) / Math.max(geometry.usableWidth, 1) * candles.length))));
          }}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={positive ? "#82f28f" : "#ff8c8c"} stopOpacity=".28" /><stop offset="1" stopColor={positive ? "#82f28f" : "#ff8c8c"} stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3, 4].map((row) => {
            const y = geometry.top + row / 4 * (geometry.priceBottom - geometry.top);
            const value = geometry.maximum - row / 4 * (geometry.maximum - geometry.minimum);
            return <g className="vnChartGrid" key={row}><line x1={geometry.left} x2={geometry.width - geometry.right + 8} y1={y} y2={y} /><text x={geometry.width - 6} y={y + 4} textAnchor="end">{value > 0 ? "$" + value.toLocaleString("en-US", { maximumSignificantDigits: 4 }) : "—"}</text></g>;
          })}
          {mode === "line" ? <><path className="vnChartArea" d={geometry.area} fill={`url(#${gradientId})`} /><path className={positive ? "vnChartLine isUp" : "vnChartLine isDown"} d={geometry.line} />{sparse && latestPoint ? <circle className="vnChartSparsePoint" cx={latestPoint.x} cy={latestPoint.y} r="4" /> : null}</> : candles.map((candle, index) => {
            const x = geometry.x(index);
            const openY = geometry.y(candle.open);
            const closeY = geometry.y(candle.close);
            const rising = candle.close >= candle.open;
            return <g className={rising ? "vnChartCandle isUp" : "vnChartCandle isDown"} key={`c:${candle.timestamp}`}><line x1={x} x2={x} y1={geometry.y(candle.high)} y2={geometry.y(candle.low)} /><rect x={x - candleWidth / 2} y={Math.min(openY, closeY)} width={candleWidth} height={Math.max(1.5, Math.abs(closeY - openY))} rx="1" /></g>;
          })}
          {candles.map((candle, index) => {
            const height = Math.max(1, candle.volume / geometry.maxVolume * (geometry.volumeBottom - geometry.volumeTop));
            return <rect className={candle.close >= candle.open ? "vnChartVolume isUp" : "vnChartVolume isDown"} x={geometry.x(index) - volumeWidth / 2} y={geometry.volumeBottom - height} width={volumeWidth} height={height} key={`v:${candle.timestamp}`} />;
          })}
          {hoveredPoint && <g className="vnChartCrosshair"><line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={geometry.top} y2={geometry.volumeBottom} /><line x1={geometry.left} x2={geometry.width - geometry.right + 8} y1={hoveredPoint.y} y2={hoveredPoint.y} /><circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="4" /></g>}
          {latestPoint && <g className="vnChartLatest"><line x1={latestPoint.x} x2={geometry.width - geometry.right + 8} y1={latestPoint.y} y2={latestPoint.y} /><circle cx={latestPoint.x} cy={latestPoint.y} r="4" /></g>}
        </svg> : <div className="vnChartEmpty" role="status"><strong>{status === "loading" ? "Loading market data" : status === "empty" ? "No recorded price history" : "Price history unavailable"}</strong><span>{status === "loading" ? "Your trade ticket is ready to use." : status === "empty" ? "No candles are reported for this token and range." : "Market data will retry quietly."}</span></div>}
      </div>
      <details className="vnChartSources"><summary>Evidence &amp; Sources</summary><dl><div><dt>Source</dt><dd>GeckoTerminal · OHLCV</dd></div><div><dt>Observed</dt><dd>{payload?.updatedAt ?? "Unavailable"}</dd></div><div><dt>State</dt><dd>{status === "stale" ? "Retained observation · market data delayed" : status === "ready" ? "Available" : status}</dd></div><div><dt>Pool</dt><dd>{payload?.pair ?? "Unavailable"}</dd></div></dl></details>
      <footer className="vnChartFooter"><span>{candles[0] ? timeLabel(candles[0].timestamp, range) : "—"}</span><span>{range} volume {candles.length ? formatVolume(totalVolume) : "—"}</span><span>{candles.at(-1) ? timeLabel(candles.at(-1)!.timestamp, range) : "—"}</span></footer>
    </section>
  );
}
