"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  POSITION_GUARD_CHANGED_EVENT,
  advancePositionGuard,
  createPositionGuard,
  defaultPositionGuardSettings,
  evaluatePositionGuard,
  positionGuardAfterConfirmedExit,
  readPositionGuard,
  removePositionGuard,
  writePositionGuard,
  type PositionGuardExitRequest,
  type PreparedPositionExit
} from "../lib/position-guard";
import { LivePositionGuardControls } from "./live-position-guard-controls";

function compactUsd(value: number) {
  return `$${value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 0 : 2
  })}`;
}

function percent(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function priceFromValue(balance: number, currentValueUsd: number) {
  if (!Number.isFinite(balance) || balance <= 0 || !Number.isFinite(currentValueUsd) || currentValueUsd <= 0) return null;
  return currentValueUsd / balance;
}

function exactSettings(input: {
  stopLossPercent: number;
  trailingStopPercent: number;
  breakEvenActivationPercent: number;
  maxPriceImpactPercent: number;
}) {
  return {
    stopLossBps: Math.round(clampNumber(input.stopLossPercent, 5, 50) * 100),
    trailingStopBps: Math.round(clampNumber(input.trailingStopPercent, 5, 50) * 100),
    breakEvenActivationBps: Math.round(clampNumber(input.breakEvenActivationPercent, 10, 100) * 100),
    maxPriceImpactBps: Math.round(clampNumber(input.maxPriceImpactPercent, 0.1, 4) * 100),
    recoverPrincipal: true,
    stagedProfitLock: true
  };
}

function levelPriceLabel(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return "—";
  return value < 0.0001
    ? `$${value.toLocaleString(undefined, { maximumSignificantDigits: 5 })}`
    : `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
}

export function PositionGuardPanel({
  wallet,
  token,
  symbol,
  balance,
  currentValueUsd,
  pair,
  rawBalance,
  onPrepareExit
}: {
  wallet: Address;
  token: string;
  symbol: string;
  balance: number;
  currentValueUsd: number;
  pair: Address;
  rawBalance: bigint;
  onPrepareExit: (request: PositionGuardExitRequest) => boolean;
}) {
  const defaults = defaultPositionGuardSettings();
  const [guard, setGuard] = useState(() => readPositionGuard(wallet, token));
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [stopLossPercent, setStopLossPercent] = useState(defaults.stopLossBps / 100);
  const [trailingStopPercent, setTrailingStopPercent] = useState(defaults.trailingStopBps / 100);
  const [breakEvenActivationPercent, setBreakEvenActivationPercent] = useState(defaults.breakEvenActivationBps / 100);
  const [maxPriceImpactPercent, setMaxPriceImpactPercent] = useState(defaults.maxPriceImpactBps / 100);
  const [recoverPrincipal, setRecoverPrincipal] = useState(defaults.recoverPrincipal);
  const [stagedProfitLock, setStagedProfitLock] = useState(defaults.stagedProfitLock);
  const currentPriceUsd = priceFromValue(balance, currentValueUsd);
  const currentSettings = exactSettings({
    stopLossPercent,
    trailingStopPercent,
    breakEvenActivationPercent,
    maxPriceImpactPercent
  });

  useEffect(() => {
    const next = readPositionGuard(wallet, token);
    setGuard(next);
    if (next) {
      setStopLossPercent(next.stopLossBps / 100);
      setTrailingStopPercent(next.trailingStopBps / 100);
      setBreakEvenActivationPercent(next.breakEvenActivationBps / 100);
      setMaxPriceImpactPercent(next.maxPriceImpactBps / 100);
      setRecoverPrincipal(next.recoverPrincipal);
      setStagedProfitLock(next.stagedProfitLock);
    }
  }, [token, wallet]);

  useEffect(() => {
    if (!guard || currentPriceUsd === null) return;
    const advanced = advancePositionGuard(guard, currentPriceUsd);
    if (advanced.updatedAt !== guard.updatedAt) {
      writePositionGuard(advanced);
      setGuard(advanced);
    }
  }, [currentPriceUsd, guard]);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ wallet?: string; token?: string }>).detail;
      if (
        detail?.wallet && detail?.token
        && (detail.wallet.toLowerCase() !== wallet.toLowerCase() || detail.token.toLowerCase() !== token.toLowerCase())
      ) return;
      setGuard(readPositionGuard(wallet, token));
    };
    window.addEventListener(POSITION_GUARD_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(POSITION_GUARD_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [token, wallet]);

  const evaluation = useMemo(
    () => guard && currentPriceUsd !== null
      ? evaluatePositionGuard(guard, currentPriceUsd)
      : null,
    [currentPriceUsd, guard]
  );

  const settingsForLiveExecution = useMemo(() => ({
    stopLossBps: guard?.stopLossBps ?? currentSettings.stopLossBps,
    trailingStopBps: guard?.trailingStopBps ?? currentSettings.trailingStopBps,
    breakEvenActivationBps: guard?.breakEvenActivationBps ?? currentSettings.breakEvenActivationBps,
    maxPriceImpactBps: guard?.maxPriceImpactBps ?? currentSettings.maxPriceImpactBps
  }), [currentSettings, guard]);

  const saveGuard = () => {
    if (currentPriceUsd === null) {
      setMessage("RMT needs a current market value before Position Guard can be enabled.");
      return;
    }
    const next = createPositionGuard({
      wallet,
      token,
      symbol,
      balance,
      currentValueUsd,
      currentPriceUsd,
      settings: {
        ...currentSettings,
        recoverPrincipal,
        stagedProfitLock
      }
    });
    writePositionGuard(next);
    setGuard(next);
    setEditing(false);
    setMessage("Position Guard is monitoring this position on this device.");
  };

  const disableGuard = () => {
    removePositionGuard(wallet, token);
    setGuard(null);
    setEditing(false);
    setMessage("Local monitoring is off. Any server-backed automatic order still appears below until it is revoked or reconciled.");
  };

  const prepareExit = (request: PositionGuardExitRequest, successMessage: string) => {
    if (!guard) return;
    const prepared = onPrepareExit(request);
    if (!prepared) {
      setMessage("RMT could not prepare this exact-token exit from the current wallet balance.");
      return;
    }
    setMessage(successMessage);
  };

  const handleConfirmedExit = (exit: PreparedPositionExit) => {
    if (!guard) return;
    const next = positionGuardAfterConfirmedExit(guard, exit);
    writePositionGuard(next);
    setGuard(next);
  };

  useEffect(() => {
    const handle = (event: Event) => {
      const exit = (event as CustomEvent<PreparedPositionExit>).detail;
      if (
        !exit || exit.wallet.toLowerCase() !== wallet.toLowerCase()
        || exit.token.toLowerCase() !== token.toLowerCase()
      ) return;
      handleConfirmedExit(exit);
    };
    window.addEventListener("rmt:position-guard-confirmed-exit", handle);
    return () => window.removeEventListener("rmt:position-guard-confirmed-exit", handle);
  }, [guard, token, wallet]);

  if (!guard) {
    return (
      <section className="positionGuardPanel idle" aria-label="Position Guard">
        <header>
          <span><small>POSITION GUARD · LOCAL</small><strong>Protect the downside and bank gains</strong></span>
          <em>OFF</em>
        </header>
        <p>Monitor this position against stop-loss, trailing-stop, break-even and staged-profit rules. Local monitoring prepares exits; it does not submit them.</p>
        {editing ? (
          <div className="positionGuardEditor">
            <label><span>STOP LOSS</span><div><b>−</b><input aria-label="Position Guard stop loss percent" type="number" min={5} max={50} step={1} value={stopLossPercent} onChange={(event) => setStopLossPercent(Number(event.target.value))} /><i>%</i></div></label>
            <label><span>TRAIL FROM HIGH</span><div><b>−</b><input aria-label="Position Guard trailing stop percent" type="number" min={5} max={50} step={1} value={trailingStopPercent} onChange={(event) => setTrailingStopPercent(Number(event.target.value))} /><i>%</i></div></label>
            <label><span>BREAK EVEN AFTER</span><div><b>+</b><input aria-label="Position Guard break even activation percent" type="number" min={10} max={100} step={5} value={breakEvenActivationPercent} onChange={(event) => setBreakEvenActivationPercent(Number(event.target.value))} /><i>%</i></div></label>
            <label><span>MAX PRICE IMPACT</span><div><input aria-label="Position Guard maximum price impact percent" type="number" min={0.1} max={4} step={0.1} value={maxPriceImpactPercent} onChange={(event) => setMaxPriceImpactPercent(Number(event.target.value))} /><i>%</i></div></label>
            <label className="positionGuardCheck"><input type="checkbox" checked={recoverPrincipal} onChange={(event) => setRecoverPrincipal(event.target.checked)} /><span>Prepare a 50% exit at 2× to recover principal.</span></label>
            <label className="positionGuardCheck"><input type="checkbox" checked={stagedProfitLock} onChange={(event) => setStagedProfitLock(event.target.checked)} /><span>Prepare staged profit exits at 3× and 5×.</span></label>
            <div className="positionGuardEditorActions"><button type="button" onClick={saveGuard}>Enable local monitoring</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        ) : (
          <div className="positionGuardStart">
            <button type="button" onClick={saveGuard}>Quick protect · −20% / 20% trail</button>
            <button type="button" onClick={() => setEditing(true)}>Customize protection</button>
          </div>
        )}
        <small className="positionGuardDisclosure">Local monitoring works only while this browser receives fresh market updates. Any existing server-backed automatic order is recovered below even when this browser has no saved local guard.</small>
        <LivePositionGuardControls
          armingEnabled={false}
          pair={pair}
          rawBalance={rawBalance}
          settings={settingsForLiveExecution}
          token={token as Address}
          wallet={wallet}
        />
        {message && <p className="positionGuardMessage" role="status">{message}</p>}
      </section>
    );
  }

  return (
    <section className={`positionGuardPanel ${evaluation?.triggered ? "triggered" : "active"}`} aria-label="Position Guard">
      <header>
        <span>
          <small>POSITION GUARD · LOCAL</small>
          <strong>{evaluation?.triggered ? "Exit condition needs review" : "Monitoring position"}</strong>
        </span>
        <em>{evaluation?.triggered ? "TRIGGERED" : evaluation?.breakEvenArmed ? "BREAK EVEN ARMED" : "ACTIVE"}</em>
      </header>
      <div className="positionGuardMetrics">
        <span><small>ENTRY</small><strong>{levelPriceLabel(guard.entryPriceUsd)}</strong><i>{compactUsd(guard.entryValueUsd)}</i></span>
        <span><small>HIGH WATER</small><strong>{levelPriceLabel(evaluation?.highWatermarkPriceUsd ?? guard.highWatermarkPriceUsd)}</strong><i>{evaluation ? percent(evaluation.changeFromEntryPct) : "—"}</i></span>
        <span><small>EFFECTIVE FLOOR</small><strong>{levelPriceLabel(evaluation?.effectiveFloorPriceUsd ?? null)}</strong><i>{evaluation ? `${percent(evaluation.distanceToFloorPct)} away` : "—"}</i></span>
      </div>
      <div className="positionGuardTrack" aria-hidden="true"><i style={{ width: `${clampNumber((evaluation?.changeFromEntryPct ?? 0) + 50, 0, 100)}%` }} /></div>

      <div className="positionGuardLadder">
        <header><span>PROFIT LADDER</span><em>Prepared exits require wallet confirmation</em></header>
        <div>
          <span className={evaluation?.principalTargetReached ? "ready" : guard.principalRecovered || guard.handledProfitTargets.includes("principal-2x") ? "handled" : ""}><small>2×</small><strong>Recover principal</strong><i>{guard.principalRecovered || guard.handledProfitTargets.includes("principal-2x") ? "Handled" : evaluation?.principalTargetReached ? "Ready" : "Watching"}</i></span>
          <span className={evaluation?.bank3xReached ? "ready" : guard.handledProfitTargets.includes("bank-3x") ? "handled" : ""}><small>3×</small><strong>Bank 25%</strong><i>{guard.handledProfitTargets.includes("bank-3x") ? "Handled" : evaluation?.bank3xReached ? "Ready" : "Watching"}</i></span>
          <span className={evaluation?.bank5xReached ? "ready" : guard.handledProfitTargets.includes("bank-5x") ? "handled" : ""}><small>5×</small><strong>Bank 20%</strong><i>{guard.handledProfitTargets.includes("bank-5x") ? "Handled" : evaluation?.bank5xReached ? "Ready" : "Watching"}</i></span>
        </div>
      </div>

      {evaluation?.triggered && (
        <div className="positionGuardTrigger">
          <strong>{evaluation.triggerLabel ?? "Protection condition triggered"}</strong>
          <span>Fresh wallet and route checks still run before the transaction can be signed.</span>
          <button type="button" onClick={() => prepareExit({ reason: evaluation.triggerReason ?? "stop-loss", exitBps: 10_000 }, "Exit ticket prepared. Review the exact route and wallet confirmation.")}>Prepare full exit</button>
        </div>
      )}

      {evaluation?.principalTargetReached && guard.recoverPrincipal && !guard.principalRecovered && !guard.handledProfitTargets.includes("principal-2x") && (
        <div className="positionGuardProfit"><span><strong>2× target reached</strong><small>Prepare a 50% exit to recover principal.</small></span><button type="button" onClick={() => prepareExit({ reason: "principal-recovery", exitBps: 5_000 }, "Principal-recovery ticket prepared. Review before signing.")}>Prepare 50% exit</button></div>
      )}
      {evaluation?.bank3xReached && guard.stagedProfitLock && !guard.handledProfitTargets.includes("bank-3x") && (
        <div className="positionGuardProfit"><span><strong>3× target reached</strong><small>Prepare a 25% profit-lock exit.</small></span><button type="button" onClick={() => prepareExit({ reason: "bank-3x", exitBps: 2_500 }, "3× profit-lock ticket prepared. Review before signing.")}>Prepare 25% exit</button></div>
      )}
      {evaluation?.bank5xReached && guard.stagedProfitLock && !guard.handledProfitTargets.includes("bank-5x") && (
        <div className="positionGuardProfit"><span><strong>5× target reached</strong><small>Prepare a 20% profit-lock exit.</small></span><button type="button" onClick={() => prepareExit({ reason: "bank-5x", exitBps: 2_000 }, "5× profit-lock ticket prepared. Review before signing.")}>Prepare 20% exit</button></div>
      )}

      {editing && (
        <div className="positionGuardEditor compact">
          <label><span>STOP LOSS</span><div><b>−</b><input aria-label="Position Guard stop loss percent" type="number" min={5} max={50} step={1} value={stopLossPercent} onChange={(event) => setStopLossPercent(Number(event.target.value))} /><i>%</i></div></label>
          <label><span>TRAIL FROM HIGH</span><div><b>−</b><input aria-label="Position Guard trailing stop percent" type="number" min={5} max={50} step={1} value={trailingStopPercent} onChange={(event) => setTrailingStopPercent(Number(event.target.value))} /><i>%</i></div></label>
          <label><span>BREAK EVEN AFTER</span><div><b>+</b><input aria-label="Position Guard break even activation percent" type="number" min={10} max={100} step={5} value={breakEvenActivationPercent} onChange={(event) => setBreakEvenActivationPercent(Number(event.target.value))} /><i>%</i></div></label>
          <label><span>MAX PRICE IMPACT</span><div><input aria-label="Position Guard maximum price impact percent" type="number" min={0.1} max={4} step={0.1} value={maxPriceImpactPercent} onChange={(event) => setMaxPriceImpactPercent(Number(event.target.value))} /><i>%</i></div></label>
          <label className="positionGuardCheck"><input type="checkbox" checked={recoverPrincipal} onChange={(event) => setRecoverPrincipal(event.target.checked)} /><span>Recover principal at 2×.</span></label>
          <label className="positionGuardCheck"><input type="checkbox" checked={stagedProfitLock} onChange={(event) => setStagedProfitLock(event.target.checked)} /><span>Use staged 3× and 5× profit locks.</span></label>
          <div className="positionGuardEditorActions"><button type="button" onClick={saveGuard}>Save rules</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
      )}

      <div className="positionGuardActions">
        <button type="button" onClick={() => setEditing((current) => !current)}>{editing ? "Close editor" : "Edit rules"}</button>
        <button type="button" onClick={() => prepareExit({ reason: "manual-protection", exitBps: 10_000 }, "Manual protection ticket prepared. Review before signing.")}>Prepare exit</button>
        <button type="button" onClick={disableGuard}>Disable local guard</button>
      </div>
      <small className="positionGuardDisclosure">Local monitoring is not an exchange stop order. Conditions can be missed when the browser, data feed or wallet is unavailable. Automatic execution below is a separate bounded delegation and remains independently revocable.</small>
      <LivePositionGuardControls
        pair={pair}
        rawBalance={rawBalance}
        settings={settingsForLiveExecution}
        token={token as Address}
        wallet={wallet}
      />
      {message && <p className="positionGuardMessage" role="status">{message}</p>}
    </section>
  );
}
