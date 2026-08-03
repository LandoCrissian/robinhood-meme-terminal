"use client";

import { useEffect, useState } from "react";
import {
  afterBuyProtectionPreset,
  normalizeAfterBuyProtectionSettings,
  type AfterBuyProtectionSettings
} from "./after-buy-protection";

const STORAGE_KEY = ["rmt", "after", "buy", "protection", "v2"].join("-");
const LEGACY_STORAGE_KEY = ["rmt", "after", "buy", "protection", "v1"].join("-");

export function useAfterBuyProtection() {
  const [settings, setSettingsState] = useState<AfterBuyProtectionSettings>(() => afterBuyProtectionPreset("off"));

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setSettingsState(normalizeAfterBuyProtectionSettings(JSON.parse(saved)));
      } else if (window.localStorage.getItem(LEGACY_STORAGE_KEY) === "enabled") {
        setSettingsState(afterBuyProtectionPreset("balanced"));
      }
    } catch {
      setSettingsState(afterBuyProtectionPreset("off"));
    }
  }, []);

  function setSettings(next: AfterBuyProtectionSettings) {
    const normalized = normalizeAfterBuyProtectionSettings(next);
    setSettingsState(normalized);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // The open ticket still keeps the selected state when storage is unavailable.
    }
  }

  return { settings, setSettings };
}
