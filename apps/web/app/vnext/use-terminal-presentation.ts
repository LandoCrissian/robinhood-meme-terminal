"use client";

import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(callback: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function desktopSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function serverSnapshot() {
  return true;
}

export function useDesktopTerminalPresentation() {
  return useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
}
