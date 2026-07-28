"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TRADE_PREFERENCES,
  readTradePreferences,
  TRADE_PREFERENCES_EVENT,
  TRADE_PREFERENCES_STORAGE_KEY,
  type TradePreferences,
  writeTradePreferences
} from "./trade-preferences";

export function useTradePreferences() {
  const [preferences, setPreferences] = useState<TradePreferences>(DEFAULT_TRADE_PREFERENCES);

  useEffect(() => {
    const refresh = () => setPreferences(readTradePreferences());
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === TRADE_PREFERENCES_STORAGE_KEY) refresh();
    };
    window.addEventListener(TRADE_PREFERENCES_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TRADE_PREFERENCES_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const save = useCallback((next: TradePreferences) => {
    const stored = writeTradePreferences(next);
    if (stored) setPreferences(readTradePreferences());
    return stored;
  }, []);

  const reset = useCallback(() => save(DEFAULT_TRADE_PREFERENCES), [save]);

  return { preferences, save, reset };
}
