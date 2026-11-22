"use client";
import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import type { MarketSnapshot } from "../../lib/token-market";
const green = "#60d7a3",
  red = "#ee828b",
  violet = "#b39aed";
const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
export function MarketChart({
  market,
  fdv,
}: {
  market: MarketSnapshot;
  fdv: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null),
    volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const marker = useRef<ISeriesMarkersPluginApi<Time> | null>(null),
    key = useRef("");
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!holder.current) return;
    const view = createChart(holder.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#101115" },
        textColor: "#b6b4bd",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#202026" },
        horzLines: { color: "#26252c" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: violet },
        horzLine: { color: violet },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#37353e",
        rightOffset: 1,
        minBarSpacing: 2,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.31 },
      },
      handleScroll: { vertTouchDrag: false, horzTouchDrag: true },
      handleScale: { pinch: true, mouseWheel: true },
    });
    chart.current = view;
    candles.current = view.addSeries(CandlestickSeries, {
      upColor: green,
      downColor: red,
      wickUpColor: green,
      wickDownColor: red,
      borderVisible: false,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });
    volume.current = view.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    view
      .priceScale("volume")
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    marker.current = createSeriesMarkers(candles.current, []);
    view.subscribeCrosshairMove((p) =>
      setHover(typeof p.time === "number" ? p.time : null),
    );
    return () => {
      view.remove();
      chart.current = null;
      candles.current = null;
      volume.current = null;
      marker.current = null;
      key.current = "";
    };
  }, []);
  useEffect(() => {
    const c = candles.current,
      v = volume.current,
      view = chart.current;
    if (!c || !v || !view) return;
    const points = [],
      volumes = [];
    for (const [i, r] of market.candles.entries()) {
      const prev = market.candles[i - 1];
      if (prev && r.time > prev.time + market.interval) {
        const gap = { time: (prev.time + market.interval) as UTCTimestamp };
        points.push(gap);
        volumes.push(gap);
      }
      const scale = fdv ? 1_000_000_000 : 1e9;
      points.push({
        time: r.time as UTCTimestamp,
        open: r.open * scale,
        high: r.high * scale,
        low: r.low * scale,
        close: r.close * scale,
      });
      volumes.push({
        time: r.time as UTCTimestamp,
        value: Number(r.volumeWei) / 1e18,
        color: r.close >= r.open ? "#35684f" : "#76474e",
      });
    }
    c.setData(points);
    v.setData(volumes);
    const g = market.graduation,
      graduationBucket =
        g && Math.floor(g.time / market.interval) * market.interval;
    marker.current?.setMarkers(
      graduationBucket &&
        market.candles.some((r) => r.time === graduationBucket)
        ? [
            {
              time: graduationBucket as UTCTimestamp,
              position: "aboveBar",
              color: violet,
              shape: "arrowDown",
              text: "v4",
            },
          ]
        : [],
    );
    const id = market.token + "-" + market.interval;
    if (key.current !== id) {
      view.timeScale().fitContent();
      key.current = id;
      setHover(null);
    }
  }, [market, fdv]);
  const bar =
    market.candles.find((r) => r.time === hover) ??
    (hover === null ? market.candles.at(-1) : null);
  return (
    <>
      <div className="rmQuotes" aria-label="Candle details">
        {bar ? (
          <>
            <time>
              {new Date(bar.time * 1000)
                .toISOString()
                .slice(5, 16)
                .replace("T", " ")}{" "}
              UTC
            </time>
            {[
              ["O", bar.open],
              ["H", bar.high],
              ["L", bar.low],
              ["C", bar.close],
            ].map(([k, n]) => (
              <span key={k}>
                <b>{k}</b> {fmt(Number(n) * 1e9)}
              </span>
            ))}
            <span>
              <b>Vol</b> {fmt(Number(bar.volumeWei) / 1e18)} ETH
            </span>
          </>
        ) : (
          <span>No trades in this interval</span>
        )}
      </div>
      <div
        className="rmCanvas"
        ref={holder}
        aria-label={
          fdv
            ? "Fully diluted valuation candlestick chart in ETH"
            : "Execution price candlestick chart in gwei per token"
        }
      />
    </>
  );
}
