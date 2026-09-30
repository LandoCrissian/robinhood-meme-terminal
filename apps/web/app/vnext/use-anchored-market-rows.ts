"use client";

import { useEffect, useRef, useState } from "react";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";

/** Freeze only the visible order during interaction. Values and exclusions
 * still publish immediately; canonical ranking resumes after interaction. */
export function useAnchoredMarketRows(markets: VNextDirectoryMarket[], context: string) {
  const [anchor, setAnchor] = useState({ context, addresses: markets.map(row => row.address) });
  const latest = useRef({ markets, context });
  latest.current = { markets, context };
  const displayed = useRef({ context, addresses: markets.map(row => row.address) });
  const held = useRef(false);
  const pointerDown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = () => {
    const next = latest.current;
    setAnchor(current => current.context === next.context && current.addresses.join(":") === next.markets.map(row => row.address).join(":")
      ? current : { context: next.context, addresses: next.markets.map(row => row.address) });
  };
  useEffect(() => {
    const release = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (pointerDown.current) return; held.current = false; publish(); }, 1_500);
    };
    const hold = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.type !== "scroll" && !target?.closest(".rmtMarketTable, .rmtMobileMarketList, .rmtAssetNavigator")) return;
      if (!held.current || event.type === "pointerdown") setAnchor(displayed.current);
      held.current = true;
      if (event.type === "pointerdown") pointerDown.current = true;
      release();
    };
    const up = () => { pointerDown.current = false; release(); };
    window.addEventListener("scroll", hold, true);
    window.addEventListener("pointerdown", hold);
    window.addEventListener("pointermove", hold);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("scroll", hold, true);
      window.removeEventListener("pointerdown", hold);
      window.removeEventListener("pointermove", hold);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);
  useEffect(() => { if (!held.current || anchor.context !== context) publish(); }, [markets, context]);
  const rank = new Map(anchor.addresses.map((address, index) => [address, index]));
  const visible = anchor.context !== context || !held.current ? markets
    : [...markets].sort((a, b) => (rank.get(a.address) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.address) ?? Number.MAX_SAFE_INTEGER));
  displayed.current = { context, addresses: visible.map(row => row.address) };
  return visible;
}
