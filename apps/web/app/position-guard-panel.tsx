"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  acknowledgeProfitTarget,
  acknowledgePrincipalRecovery,
  advancePositionGuard,
  createPositionGuard,
  evaluatePositionGuard,
  POSITION_GUARD_CHANGED_EVENT,
  readPositionGuard,
  removePositionGuard,
  resetPositionGuardTrigger,
  writePositionGuard,
  type PositionGuard,
  type PositionGuardExitReason,
  type PositionGuardExitRequest
} from "../lib/position-guard";
import { type Address } from "viem";
import { LivePositionGuardControls } from "./live-position-guard-controls";

function money(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 10 ? 2 : 0
  });
}

function percent(bps: number) {
  return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function profitTargetLabel(key: "principal-2x" | "bank-3x" | "bank-5x") {
  if (key === "principal-2x") return "Recover basis";
  if (key === "bank-3x") return "Bank 25%";
  return "Bank 20%";
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
  wallet: string;
  token: string;
  symbol: string;
  balance: number;
  currentValueUsd: number;
  pair?: Address;
  rawBalance?: bigint;
  onPrepareExit: (request: PositionGuardExitRequest) => boolean;
}) {
  const [guard, setGuard] = useState<PositionGuard | null>(null);
  const [editing, setEditing] = useState(false);
  const [basis, setBasis] = useState("");
  const [stopLossBps, setStopLossBps] = useState(2000);
  const [trailingStopBps, setTrailingStopBps] = useState(2000);
  const [breakEvenActivationBps, setBreakEvenActivationBps] = useState(5000);
  const [recoverPrincipal, setRecoverPrincipal] = useState(true);
  const [stagedProfitLock, setStagedProfitLock] = useState(true);
  const [message, setMessage] = useState("");
  const notifiedTrigger = useRef<number | null>(null);
  const notifiedProfitTarget = useRef<string | null>(null);

  useEffect(() => {
    const load = () => {
      const stored = readPositionGuard(wallet, token);
      setGuard(stored);
      setEditing(false);
      setBasis(stored ? String(stored.basisUsd) : currentValueUsd > 0 ? currentValueUsd.toFixed(2) : "");
      setStopLossBps(stored?.stopLossBps ?? 2000);
      setTrailingStopBps(stored?.trailingStopBps ?? 2000);
      setBreakEvenActivationBps(stored?.breakEvenActivationBps ?? 5000);
      setRecoverPrincipal(stored?.recoverPrincipal ?? true);
      setStagedProfitLock(stored?.stagedProfitLock ?? true);
      setMessage("");
      notifiedTrigger.current = stored?.triggeredAt ?? null;
      notifiedProfitTarget.current = null;
    };
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ wallet?: string; token?: string }>).detail;
      if (detail?.wallet !== wallet.toLowerCase() || detail?.token !== token.toLowerCase()) return;
      load();
    };
    load();
    window.addEventListener(POSITION_GUARD_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(POSITION_GUARD_CHANGED_EVENT, handleChange);
  }, [token, wallet]);

  useEffect(() => {
    if (!guard || currentValueUsd <= 0) return;
    const next = advancePositionGuard(guard, currentValueUsd, Date.now(), balance);
    if (
      next.highWatermarkUsd === guard.highWatermarkUsd
      && next.triggeredAt === guard.triggeredAt
      && next.updatedAt === guard.updatedAt
    ) return;
    if (writePositionGuard(next)) setGuard(next);
  }, [balance, currentValueUsd, guard]);

  const evaluation = useMemo(
    () => guard ? evaluatePositionGuard(guard, currentValueUsd, balance) : null,
    [balance, currentValueUsd, guard]
  );

  useEffect(() => {
    if (!guard?.triggeredAt || notifiedTrigger.current === guard.triggeredAt) return;
    notifiedTrigger.current = guard.triggeredAt;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([160, 80, 160]);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`RMT Position Guard · ${symbol}`, {
        body: `Your protected floor was reached. Reopen RMT to review a fresh sell quote.`,
        tag: `rmt-position-guard:${wallet}:${token}`
      });
    }
  }, [guard?.triggeredAt, symbol, token, wallet]);

  function arm(inputBasis: number) {
    const next = createPositionGuard({
      wallet,
      token,
      basisUsd: inputBasis,
      currentValueUsd,
      tokenBalance: balance,
      stopLossBps,
      trailingStopBps,
      breakEvenActivationBps,
      recoverPrincipal,
      stagedProfitLock
    });
    if (!next || !writePositionGuard(next)) {
      setMessage("Position Guard could not be saved on this device.");
      return;
    }
    setGuard(next);
    setEditing(false);
    setMessage("Position Guard armed. Its protected floor can rise, but never move backward.");
  }

  function saveCustom() {
    const inputBasis = Number(basis);
    if (!Number.isFinite(inputBasis) || inputBasis <= 0) {
      setMessage("Enter the amount originally invested in USD.");
      return;
    }
    arm(inputBasis);
  }

  function quickProtect() {
    if (currentValueUsd <= 0) return;
    setStopLossBps(2000);
    setTrailingStopBps(2000);
    setBreakEvenActivationBps(5000);
    setRecoverPrincipal(true);
    setStagedProfitLock(true);
    const next = createPositionGuard({
      wallet,
      token,
      basisUsd: currentValueUsd,
      currentValueUsd,
      tokenBalance: balance,
      stopLossBps: 2000,
      trailingStopBps: 2000,
      breakEvenActivationBps: 5000,
      recoverPrincipal: true,
      stagedProfitLock: true
    });
    if (!next || !writePositionGuard(next)) {
      setMessage("Position Guard could not be saved on this device.");
      return;
    }
    setGuard(next);
    setEditing(false);
    setMessage("Protect my win is armed: 20% trailing floor plus staged profit prompts.");
  }

  function prepareExit(exitBps: number, reason: PositionGuardExitReason) {
    if (!onPrepareExit({ exitBps, reason })) {
      setMessage("RMT could not read an exact onchain balance for this exit. Refresh the position and try again.");
    }
  }

  function resetTrigger() {
    if (!guard) return;
    const next = resetPositionGuardTrigger(guard, currentValueUsd, Date.now(), balance);
    if (writePositionGuard(next)) {
      notifiedTrigger.current = null;
      setGuard(next);
      setMessage("Trigger reset from the current position value.");
    }
  }

  function dismissProfitTarget(target: "principal-2x" | "bank-3x" | "bank-5x") {
    if (!guard) return;
    const next = target === "principal-2x"
      ? acknowledgePrincipalRecovery(guard)
      : acknowledgeProfitTarget(guard, target);
    if (writePositionGuard(next)) {
      setGuard(next);
      setMessage(`${profitTargetLabel(target)} marked handled on this device.`);
    }
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setMessage("This browser does not support system notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    setMessage(permission === "granted"
      ? "Browser alerts enabled while RMT is open."
      : "Browser alerts were not enabled. In-app monitoring remains active.");
  }

  useEffect(() => {
    const target = evaluation?.activeProfitTarget;
    if (!target || notifiedProfitTarget.current === target.key || evaluation?.stopTriggered) return;
    notifiedProfitTarget.current = target.key;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([120, 60, 120]);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`RMT Profit Lock · ${symbol}`, {
        body: `${profitTargetLabel(target.key)} is ready. Reopen RMT to review a fresh partial-sell quote.`,
        tag: `rmt-profit-lock:${wallet}:${token}:${target.key}`
      });
    }
  }, [evaluation?.activeProfitTarget, evaluation?.stopTriggered, symbol, token, wallet]);

  function removeGuard() {
    if (!removePositionGuard(wallet, token)) return;
    setGuard(null);
    setEditing(false);
    setMessage("Position Guard removed.");
  }

  if (!guard) {
    return (
      <section className="positionGuardPanel idle" aria-labelledby="position-guard-heading">
        <header>
          <span><small>POSITION GUARD</small><strong id="position-guard-heading">Protect this position</strong></span>
          <em>Manual execution</em>
        </header>
        <p>A trailing floor follows gains upward and never follows a falling position back down.</p>
        {!editing ? (
          <div className="positionGuardStart">
            <button type="button" onClick={quickProtect}>Protect my win</button>
            <button type="button" onClick={() => setEditing(true)}>Customize</button>
          </div>
        ) : (
          <div className="positionGuardEditor">
            <label>
              <span>Original investment</span>
              <div><b>$</b><input inputMode="decimal" type="number" min="0" value={basis} onChange={(event) => setBasis(event.target.value)} /></div>
            </label>
            <label><span>Initial stop</span><select value={stopLossBps} onChange={(event) => setStopLossBps(Number(event.target.value))}>
              <option value={1000}>10% below basis</option><option value={1500}>15% below basis</option><option value={2000}>20% below basis</option><option value={2500}>25% below basis</option><option value={3000}>30% below basis</option><option value={4000}>40% below basis</option><option value={5000}>50% below basis</option>
            </select></label>
            <label><span>Trailing distance</span><select value={trailingStopBps} onChange={(event) => setTrailingStopBps(Number(event.target.value))}>
              <option value={500}>5% behind peak</option><option value={1000}>10% behind peak</option><option value={1500}>15% behind peak</option><option value={2000}>20% behind peak</option><option value={2500}>25% behind peak</option><option value={3000}>30% behind peak</option><option value={4000}>40% behind peak</option><option value={5000}>50% behind peak</option>
            </select></label>
            <label><span>Move to break-even after</span><select value={breakEvenActivationBps} onChange={(event) => setBreakEvenActivationBps(Number(event.target.value))}>
              <option value={1000}>+10%</option><option value={2500}>+25%</option><option value={5000}>+50%</option><option value={7500}>+75%</option><option value={10000}>+100%</option>
            </select></label>
            <label className="positionGuardCheck"><input type="checkbox" checked={recoverPrincipal} onChange={(event) => setRecoverPrincipal(event.target.checked)} /><span>Prompt me to recover my original investment at 2×</span></label>
            <label className="positionGuardCheck"><input type="checkbox" checked={stagedProfitLock} onChange={(event) => setStagedProfitLock(event.target.checked)} /><span>Prompt me to bank 25% at 3× and 20% at 5×</span></label>
            <div className="positionGuardEditorActions"><button type="button" onClick={saveCustom}>Arm Position Guard</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        )}
        <small className="positionGuardDisclosure">RMT monitors while this market is open. A trigger prepares a fresh sell ticket; it does not trade without your wallet.</small>
        {message && <p className="positionGuardMessage" role="status">{message}</p>}
      </section>
    );
  }

  return (
    <section className={`positionGuardPanel armed ${evaluation?.stopTriggered ? "triggered" : ""}`} aria-labelledby="position-guard-heading">
      <header>
        <span><small>POSITION GUARD · ARMED</small><strong id="position-guard-heading">{evaluation?.stopTriggered ? "Protected floor reached" : "Following this position"}</strong></span>
        <em>{evaluation?.breakEvenArmed ? "Break-even locked" : `${percent(guard.trailingStopBps)} trail`}</em>
      </header>
      {evaluation && (
        <>
          <div className="positionGuardMetrics">
            <span><small>CURRENT</small><strong>{money(evaluation.currentValueUsd)}</strong><i className={evaluation.gainBps >= 0 ? "positive" : "negative"}>{evaluation.gainBps >= 0 ? "+" : ""}{percent(evaluation.gainBps)}</i></span>
            <span>
              <small>{evaluation.priceTracked ? "PEAK TOKEN PRICE" : "RECORDED PEAK"}</small>
              <strong>{money(evaluation.priceTracked ? evaluation.highWatermarkPriceUsd! : evaluation.highWatermarkUsd)}</strong>
              <i>On this device</i>
            </span>
            <span><small>PROTECTED FLOOR</small><strong>{money(evaluation.effectiveStopUsd)}</strong><i>{percent(evaluation.distanceToStopBps)} below current</i></span>
          </div>
          <div className="positionGuardTrack" aria-label={`Current value ${money(evaluation.currentValueUsd)}; protected floor ${money(evaluation.effectiveStopUsd)}`}>
            <i style={{ width: `${Math.min(100, evaluation.effectiveStopUsd / evaluation.highWatermarkUsd * 100)}%` }} />
          </div>
          {evaluation.profitTargets.length > 0 && (
            <div className="positionGuardLadder" aria-label="Profit lock plan">
              <header><span>PROFIT LOCK</span><em>Prepared sells only</em></header>
              <div>
                {evaluation.profitTargets.map((target) => (
                  <span className={target.handled ? "handled" : target.ready ? "ready" : "upcoming"} key={target.key}>
                    <small>{target.multipleBps / 10_000}×</small>
                    <strong>{profitTargetLabel(target.key)}</strong>
                    <i>{target.handled ? "Handled" : target.ready ? "Ready" : "Waiting"}</i>
                  </span>
                ))}
              </div>
            </div>
          )}
          {evaluation.stopTriggered && (
            <div className="positionGuardTrigger" role="alert">
              <strong>Exit review required</strong>
              <span>The current position value reached the highest active protection rule. RMT will request a new executable quote.</span>
              <button type="button" onClick={() => prepareExit(10_000, "protected-floor")}>Prepare full exit</button>
              <button type="button" onClick={resetTrigger}>Keep position · reset trail</button>
            </div>
          )}
          {evaluation.activeProfitTarget && !evaluation.stopTriggered && (
            <div className="positionGuardProfit" role="alert">
              <span>
                <small>{evaluation.activeProfitTarget.multipleBps / 10_000}× TARGET REACHED</small>
                <strong>{evaluation.activeProfitTarget.key === "principal-2x" ? `Recover the original ${money(guard.basisUsd)}` : profitTargetLabel(evaluation.activeProfitTarget.key)}</strong>
                <em>{evaluation.activeProfitTarget.key === "principal-2x" ? "Estimated" : "Prepare"} {percent(evaluation.activeProfitTarget.exitBps)} of current holdings</em>
              </span>
              <button type="button" onClick={() => prepareExit(evaluation.activeProfitTarget!.exitBps, evaluation.activeProfitTarget!.key)}>Prepare partial exit</button>
              <button type="button" onClick={() => dismissProfitTarget(evaluation.activeProfitTarget!.key)}>Mark handled</button>
            </div>
          )}
        </>
      )}
      <div className="positionGuardActions">
        <button type="button" onClick={() => void enableNotifications()}>Enable browser alert</button>
        <button type="button" onClick={() => { setBasis(String(guard.basisUsd)); setEditing(true); }}>Edit rules</button>
        <button type="button" onClick={removeGuard}>Remove</button>
      </div>
      {pair && rawBalance !== undefined && (
        <LivePositionGuardControls
          pair={pair}
          rawBalance={rawBalance}
          settings={{
            stopLossBps: guard.stopLossBps,
            trailingStopBps: guard.trailingStopBps,
            breakEvenActivationBps: guard.breakEvenActivationBps,
            maxPriceImpactBps: 400
          }}
          token={token as Address}
          wallet={wallet as Address}
        />
      )}
      {editing && (
        <div className="positionGuardEditor compact">
          <label><span>Original investment</span><div><b>$</b><input inputMode="decimal" type="number" min="0" value={basis} onChange={(event) => setBasis(event.target.value)} /></div></label>
          <label><span>Initial stop</span><select value={stopLossBps} onChange={(event) => setStopLossBps(Number(event.target.value))}><option value={1000}>10%</option><option value={1500}>15%</option><option value={2000}>20%</option><option value={2500}>25%</option><option value={3000}>30%</option><option value={4000}>40%</option><option value={5000}>50%</option></select></label>
          <label><span>Trailing distance</span><select value={trailingStopBps} onChange={(event) => setTrailingStopBps(Number(event.target.value))}><option value={500}>5%</option><option value={1000}>10%</option><option value={1500}>15%</option><option value={2000}>20%</option><option value={2500}>25%</option><option value={3000}>30%</option><option value={4000}>40%</option><option value={5000}>50%</option></select></label>
          <label><span>Break-even after</span><select value={breakEvenActivationBps} onChange={(event) => setBreakEvenActivationBps(Number(event.target.value))}><option value={1000}>+10%</option><option value={2500}>+25%</option><option value={5000}>+50%</option><option value={7500}>+75%</option><option value={10000}>+100%</option></select></label>
          <label className="positionGuardCheck"><input type="checkbox" checked={recoverPrincipal} onChange={(event) => setRecoverPrincipal(event.target.checked)} /><span>Principal recovery at 2×</span></label>
          <label className="positionGuardCheck"><input type="checkbox" checked={stagedProfitLock} onChange={(event) => setStagedProfitLock(event.target.checked)} /><span>Bank gains at 3× and 5×</span></label>
          <div className="positionGuardEditorActions"><button type="button" onClick={saveCustom}>Save and re-arm</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
      )}
      <small className="positionGuardDisclosure">Value uses the indexed market price; the sell ticket still requires a fresh route quote, price-impact review, and your wallet signature. Browser alerts require RMT to remain open in this release.</small>
      {message && <p className="positionGuardMessage" role="status">{message}</p>}
    </section>
  );
}
