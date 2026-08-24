"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  EXTERNAL_CHART_RANGES,
  externalChartRefreshMs,
  type ExternalChartRange,
  type ExternalOhlcvCandle,
  type ExternalOhlcvPayload
} from "../../lib/external-ohlcv";
import { useVisibilityRefresh } from "./use-visibility-refresh";

type ChartMode = "candles" | "line";
type ChartStatus = "loading" | "ready" | "stale" | "unavailable";

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

function acceptPayload(value: unknown, token: string, pair: string, range: ExternalChartRange) {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<ExternalOhlcvPayload>;
  if (
    payload.token?.toLowerCase() !== token.toLowerCase()
    || payload.pair?.toLowerCase() !== pair.toLowerCase()
    || payload.range !== range
    || payload.source !== "GeckoTerminal"
    || !Array.isArray(payload.candles)
    || payload.candles.length < 2
  ) return null;
  return payload as ExternalOhlcvPayload;
}

function payloadSignature(payload: ExternalOhlcvPayload) {
  const latest = payload.candles.at(-1);
  return `${payload.range}:${payload.candles.length}:${latest?.timestamp}:${latest?.close}:${latest?.volume}`;
}

export function VNextMarketChart({ token, pair, symbol }: {
  token: string;
  pair: string;
  symbol: string;
}) {
  const gradientId = useId().replaceAll(":", "");
  const [range, setRange] = useState<ExternalChartRange>("1H");
  const [mode, setMode] = useState<ChartMode>("candles");
  const [payload, setPayload] = useState<ExternalOhlcvPayload>();
  const [status, setStatus] = useState<ChartStatus>("loading");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const signature = useRef("");
  const requestId = useRef(0);
  const chartKey = `${token.toLowerCase()}:${pair.toLowerCase()}:${range}`;
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
    const timeout = window.setTimeout(() => controller.abort(), 9_000);
    try {
      const query = new URLSearchParams({ token, pair, range });
      const response = await fetch(`/api/markets/ohlcv?${query}`, { signal: controller.signal });
      const next = acceptPayload(await response.json(), token, pair, range);
      if (!response.ok || !next) throw new Error("Chart response unavailable.");
      if (id !== requestId.current) return;
      const nextSignature = payloadSignature(next);
      if (signature.current !== nextSignature) {
        signature.current = nextSignature;
        setPayload(next);
      }
      setStatus("ready");
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

  const candles = payload?.candles ?? [];
  const geometry = useMemo(() => {
    const width = 920;
    const height = 400;
    const left = 18;
    const right = 86;
    const top = 22;
    const priceBottom = 292;
    const volumeTop = 318;
    const volumeBottom = 376;
    const usableWidth = width - left - right;
    const minimum = candles.length ? Math.min(...candles.map((candle) => candle.low)) : 0;
    const maximum = candles.length ? Math.max(...candles.map((candle) => candle.high)) : 0;
    const priceRange = maximum - minimum || maximum * 0.02 || 1;
    const maxVolume = Math.max(1, ...candles.map((candle) => candle.volume));
    const x = (index: number) => left + index / Math.max(1, candles.length - 1) * usableWidth;
    const y = (value: number) => top + (1 - (value - minimum) / priceRange) * (priceBottom - top);
    const points = candles.map((candle, index) => ({ x: x(index), y: y(candle.close) }));
    const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
    return {
      width, height, left, right, top, priceBottom, volumeTop, volumeBottom, usableWidth,
      minimum, maximum, maxVolume, x, y, points, line,
      area: points.length > 1 ? `${line} L${points.at(-1)?.x} ${priceBottom} L${points[0].x} ${priceBottom} Z` : ""
    };
  }, [candles]);

  const first = candles[0]?.open ?? 0;
  const latest = candles.at(-1)?.close ?? 0;
  const change = first > 0 ? (latest - first) / first * 100 : 0;
  const positive = change >= 0;
  const hovered = hoveredIndex === null ? undefined : candles[hoveredIndex];
  const hoveredPoint = hoveredIndex === null ? undefined : geometry.points[hoveredIndex];
  const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  const latestPoint = geometry.points.at(-1);
  const candleWidth = Math.max(2.5, Math.min(11, geometry.usableWidth / Math.max(candles.length, 1) * 0.66));
  const volumeWidth = Math.max(2, geometry.usableWidth / Math.max(candles.length, 1) - 1.5);

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
          <span className="vnEyebrow">Verified pool chart</span>
          <div><strong id="vn-chart-title">{formatPrice(hovered?.close ?? latest)}</strong><span className={positive ? "vnPositive" : "vnNegative"}>{positive ? "+" : "−"}{Math.abs(change).toFixed(2)}%</span></div>
          <small>{hovered ? timeLabel(hovered.timestamp, range) : `${symbol} · ${range}`} · {status === "stale" ? "Last loaded snapshot" : "GeckoTerminal OHLCV"}</small>
        </div>
        <div className="vnChartControls">
          <div className="vnChartModes" role="group" aria-label="Chart display">
            <button type="button" aria-pressed={mode === "candles"} className={mode === "candles" ? "isActive" : ""} onClick={() => changeMode("candles")}>Candles</button>
            <button type="button" aria-pressed={mode === "line"} className={mode === "line" ? "isActive" : ""} onClick={() => changeMode("line")}>Line</button>
          </div>
          <span className={`vnChartState is${status}`} role="status"><i aria-hidden="true" />{status === "loading" ? "Loading" : status === "ready" ? "Live data" : status === "stale" ? "Retrying" : "Unavailable"}</span>
        </div>
      </header>
      <div className="vnChartRanges" role="tablist" aria-label="Price chart range">
        {EXTERNAL_CHART_RANGES.map((item) => <button type="button" role="tab" aria-selected={range === item} className={range === item ? "isActive" : ""} onClick={() => setRange(item)} key={item}>{item}</button>)}
      </div>
      <div className="vnChartFrame">
        {hovered && hoveredPoint && <div className={`vnChartTooltip${hoveredIndex !== null && hoveredIndex > candles.length / 2 ? " isLeft" : ""}`}>
          <span>{timeLabel(hovered.timestamp, range)}</span>
          <dl><div><dt>O</dt><dd>{formatPrice(hovered.open)}</dd></div><div><dt>H</dt><dd>{formatPrice(hovered.high)}</dd></div><div><dt>L</dt><dd>{formatPrice(hovered.low)}</dd></div><div><dt>C</dt><dd>{formatPrice(hovered.close)}</dd></div><div><dt>Vol</dt><dd>{formatVolume(hovered.volume)}</dd></div></dl>
        </div>}
        {candles.length >= 2 ? <svg
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img"
          aria-label={`${symbol} ${range} ${mode} chart with volume`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const pointerX = (event.clientX - rect.left) / Math.max(rect.width, 1) * geometry.width;
            setHoveredIndex(Math.max(0, Math.min(candles.length - 1, Math.round((pointerX - geometry.left) / Math.max(geometry.usableWidth, 1) * Math.max(candles.length - 1, 1)))));
          }}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={positive ? "#82f28f" : "#ff8c8c"} stopOpacity=".28" /><stop offset="1" stopColor={positive ? "#82f28f" : "#ff8c8c"} stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3, 4].map((row) => {
            const y = geometry.top + row / 4 * (geometry.priceBottom - geometry.top);
            const value = geometry.maximum - row / 4 * (geometry.maximum - geometry.minimum);
            return <g className="vnChartGrid" key={row}><line x1={geometry.left} x2={geometry.width - geometry.right + 8} y1={y} y2={y} /><text x={geometry.width - 6} y={y + 4} textAnchor="end">{formatPrice(value)}</text></g>;
          })}
          {mode === "line" ? <><path className="vnChartArea" d={geometry.area} fill={`url(#${gradientId})`} /><path className={positive ? "vnChartLine isUp" : "vnChartLine isDown"} d={geometry.line} /></> : candles.map((candle, index) => {
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
        </svg> : <div className="vnChartEmpty" role="status"><strong>{status === "loading" ? "Loading price history" : "Chart temporarily unavailable"}</strong><span>{status === "loading" ? "The rest of the terminal remains usable while OHLCV loads." : "RMT will retry quietly. No price history is being invented."}</span></div>}
      </div>
      <footer className="vnChartFooter"><span>{candles[0] ? timeLabel(candles[0].timestamp, range) : "—"}</span><span>Volume {formatVolume(totalVolume)}</span><span>{candles.at(-1) ? timeLabel(candles.at(-1)!.timestamp, range) : "—"}</span></footer>
    </section>
  );
}
