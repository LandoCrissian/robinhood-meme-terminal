"use client";

import { useSyncExternalStore } from "react";
import { ExternalMarketFeed } from "./external-market-feed";
import { ExternalMarketFeedV10 } from "./external-market-feed-v10";

const DESKTOP_QUERY = "(min-width: 761px)";

function subscribe(callback: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getServerSnapshot() {
  return true;
}

export function ResponsiveExternalMarketFeed() {
  const desktop = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return desktop ? <ExternalMarketFeedV10 /> : <ExternalMarketFeed />;
}
