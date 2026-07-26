"use client";

import { useEffect } from "react";

export function LegacyHomeRedirect() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("externalTrade") && url.hash !== "#runner-radar") return;
    window.location.replace("/explore" + url.search + "#market-explorer");
  }, []);

  return null;
}
