"use client";

import { useCallback, useEffect, useState } from "react";
import {
  parseTradingTermsAcceptance,
  TRADING_TERMS_EVENT,
  TRADING_TERMS_STORAGE_KEY,
  tradingTermsAcceptanceRecord
} from "./trading-terms";

let sessionAccepted = false;

export function useTradingTermsAcceptance() {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const refresh = useCallback(() => {
    try {
      setAccepted(sessionAccepted || parseTradingTermsAcceptance(window.localStorage.getItem(TRADING_TERMS_STORAGE_KEY)));
    } catch {
      setAccepted(sessionAccepted);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === TRADING_TERMS_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(TRADING_TERMS_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(TRADING_TERMS_EVENT, refresh);
    };
  }, [refresh]);

  const accept = useCallback(() => {
    sessionAccepted = true;
    setAccepted(true);
    try {
      window.localStorage.setItem(TRADING_TERMS_STORAGE_KEY, tradingTermsAcceptanceRecord());
    } catch {
      // The acceptance still applies for this tab when persistent storage is unavailable.
    }
    window.dispatchEvent(new Event(TRADING_TERMS_EVENT));
  }, []);

  return { accepted, ready, accept };
}
