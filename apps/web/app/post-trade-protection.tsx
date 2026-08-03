"use client";

import { useEffect, useState } from "react";
import {
  afterBuyProtectionEnabled,
  afterBuyProtectionPreset,
  type AfterBuyProtectionPreset,
  type AfterBuyProtectionSettings
} from "../lib/after-buy-protection";
import type { ConfirmedBuyProtectionSnapshot } from "../lib/confirmed-buy-protection";
import { createPositionGuard, readPositionGuard, writePositionGuard } from "../lib/position-guard";

function money(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 10 ? 2 : 0
  });
}

function units(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function armProtection(input: {
  wallet: string;
  token: string;
  snapshot: ConfirmedBuyProtectionSnapshot;
  settings: AfterBuyProtectionSettings;
}) {
  if (readPositionGuard(input.wallet, input.token)) return "existing" as const;
  const guard = createPositionGuard({
    wallet: input.wallet,
    token: input.token,
    basisUsd: input.snapshot.basisUsd,
    currentValueUsd: input.snapshot.currentValueUsd,
    tokenBalance: input.snapshot.totalTokenBalance,
    stopLossBps: input.settings.stopLossBps,
    trailingStopBps: input.settings.trailingStopBps,
    breakEvenActivationBps: input.settings.breakEvenActivationBps,
    recoverPrincipal: input.settings.recoverPrincipal,
    stagedProfitLock: input.settings.stagedProfitLock
  });
  return guard && writePositionGuard(guard) ? "armed" as const : "error" as const;
}

export function TradeProtectionIntent({
  settings,
  onChange
}: {
  settings: AfterBuyProtectionSettings;
  onChange: (settings: AfterBuyProtectionSettings) => void;
}) {
  const enabled = afterBuyProtectionEnabled(settings);
  const presetOptions: Array<{ key: Exclude<AfterBuyProtectionPreset, "off">; label: string }> = [
    { key: "tight", label: "Tight" },
    { key: "balanced", label: "Balanced" },
    { key: "wide", label: "Wide" },
    { key: "custom", label: "Custom" }
  ];
  const updateCustom = (patch: Partial<AfterBuyProtectionSettings>) => {
    onChange({ ...settings, ...patch, preset: "custom" });
  };

  return (
    <section className={`tradeProtectionIntent ${enabled ? "enabled" : ""}`} aria-label="Protection after this buy">
      <label className="tradeProtectionIntentToggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(afterBuyProtectionPreset(event.target.checked ? "balanced" : "off"))}
        />
        <span>
          <small>AFTER CONFIRMATION</small>
          <strong>Protect my win</strong>
          <em>Save monitoring rules only after the received balance is confirmed.</em>
        </span>
        <b>{enabled ? "ON" : "OFF"}</b>
      </label>
      {enabled && (
        <div className="tradeProtectionPresetRow" role="group" aria-label="Protection preset">
          {presetOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={settings.preset === option.key ? "active" : ""}
              aria-pressed={settings.preset === option.key}
              onClick={() => onChange(afterBuyProtectionPreset(option.key))}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {enabled && settings.preset !== "custom" && (
        <p className="tradeProtectionPresetSummary">
          {settings.trailingStopBps / 100}% trail · break-even after +{settings.breakEvenActivationBps / 100}% · profit prompts on
        </p>
      )}
      {settings.preset === "custom" && (
        <div className="tradeProtectionCustom">
          <label>
            <span>Initial stop</span>
            <select value={settings.stopLossBps} onChange={(event) => updateCustom({ stopLossBps: Number(event.target.value) })}>
              {[500, 1000, 1500, 2000, 2500, 3000, 4000, 5000].map((value) => <option key={value} value={value}>{value / 100}%</option>)}
            </select>
          </label>
          <label>
            <span>Trailing distance</span>
            <select value={settings.trailingStopBps} onChange={(event) => updateCustom({ trailingStopBps: Number(event.target.value) })}>
              {[500, 1000, 1500, 2000, 2500, 3000, 4000, 5000].map((value) => <option key={value} value={value}>{value / 100}%</option>)}
            </select>
          </label>
          <label>
            <span>Break-even after</span>
            <select value={settings.breakEvenActivationBps} onChange={(event) => updateCustom({ breakEvenActivationBps: Number(event.target.value) })}>
              {[1000, 2500, 5000, 7500, 10000].map((value) => <option key={value} value={value}>+{value / 100}%</option>)}
            </select>
          </label>
          <label className="tradeProtectionCustomCheck">
            <input type="checkbox" checked={settings.recoverPrincipal} onChange={(event) => updateCustom({ recoverPrincipal: event.target.checked })} />
            <span>Principal prompt at 2×</span>
          </label>
          <label className="tradeProtectionCustomCheck">
            <input type="checkbox" checked={settings.stagedProfitLock} onChange={(event) => updateCustom({ stagedProfitLock: event.target.checked })} />
            <span>Profit prompts at 3× and 5×</span>
          </label>
        </div>
      )}
    </section>
  );
}

export function PostTradeProtection({
  wallet,
  token,
  symbol,
  transactionHash,
  snapshot,
  protectionSettings
}: {
  wallet: string;
  token: string;
  symbol: string;
  transactionHash: string;
  snapshot: ConfirmedBuyProtectionSnapshot;
  protectionSettings?: AfterBuyProtectionSettings;
}) {
  const [state, setState] = useState<"ready" | "existing" | "armed" | "error">("ready");
  const autoArm = Boolean(protectionSettings && afterBuyProtectionEnabled(protectionSettings));

  useEffect(() => {
    setState(
      autoArm && protectionSettings
        ? armProtection({ wallet, token, snapshot, settings: protectionSettings })
        : readPositionGuard(wallet, token) ? "existing" : "ready"
    );
  }, [autoArm, protectionSettings, snapshot, token, transactionHash, wallet]);

  function protect() {
    setState(armProtection({ wallet, token, snapshot, settings: afterBuyProtectionPreset("balanced") }));
  }

  const basisLabel = snapshot.basisKind === "confirmed-purchase"
    ? "Confirmed purchase reference"
    : snapshot.basisKind === "full-position-reference"
      ? "Full position reference from confirmation"
      : "Market-value estimate at confirmation";

  return (
    <section className={`postTradeProtection ${state}`} aria-labelledby={`post-trade-protection-${transactionHash}`}>
      <header>
        <span><small>SWAP CONFIRMED · NEXT STEP</small><strong id={`post-trade-protection-${transactionHash}`}>Protect the position</strong></span>
        <em>{state === "armed" ? "Armed" : state === "existing" ? "Already active" : "Optional"}</em>
      </header>
      <div>
        <span><small>RECEIVED</small><strong>{units(snapshot.acquiredTokenBalance)} {symbol}</strong></span>
        <span><small>RECORDED REFERENCE</small><strong>{money(snapshot.basisUsd)}</strong></span>
      </div>
      {state === "ready" && <button type="button" onClick={protect}>Protect my win</button>}
      {state === "armed" && <p>{autoArm ? "Armed after confirmation. " : ""}{(protectionSettings?.trailingStopBps ?? 2_000) / 100}% trailing floor, break-even protection and selected profit prompts are now active.</p>}
      {state === "existing" && <p>Your existing Position Guard was preserved. RMT did not overwrite its cost basis or rules.</p>}
      {state === "error" && <p role="alert">Protection could not be saved on this device. Your confirmed swap was not affected.</p>}
      <footer>{basisLabel}. RMT prepares exits; it never sells without a fresh quote and wallet signature.</footer>
    </section>
  );
}
