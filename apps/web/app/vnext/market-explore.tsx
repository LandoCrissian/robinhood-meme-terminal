"use client";
import { useRef, useState } from "react";
import { MARKET_UNIVERSE_LABELS, type MarketUniverse } from "../../lib/vnext/market-universe";
import { TerminalIcon } from "./terminal-icon";
import { heldCountLabel, type VNextWalletReadStatus } from "../../lib/vnext/terminal-presentation-state";

export function MarketExplore({ scope, counts, onChange, walletReadStatus }: { scope: MarketUniverse; counts: Record<MarketUniverse, number | null>; onChange: (scope: MarketUniverse) => void; walletReadStatus: VNextWalletReadStatus }) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const show = () => {
    const target = dialog.current, anchor = trigger.current?.getBoundingClientRect();
    if (!target || !anchor) return;
    target.style.setProperty("--explore-left", `${Math.max(16, Math.min(anchor.left, window.innerWidth - 336))}px`);
    target.style.setProperty("--explore-top", `${Math.min(anchor.bottom + 8, Math.max(16, window.innerHeight - 384))}px`);
    target.showModal(); setOpen(true);
  };
  const group = (title: string, scopes: MarketUniverse[]) => <fieldset><legend>{title}</legend>{scopes.map(item => <button key={item} type="button" aria-pressed={scope === item} onClick={() => { onChange(item); close(); }}><span>{MARKET_UNIVERSE_LABELS[item]}</span><small>{item === "held" ? heldCountLabel(walletReadStatus, counts.held ?? 0) : counts[item] ?? "—"}</small>{scope === item ? <span aria-hidden="true">✓</span> : null}</button>)}</fieldset>;
  return <div className="rmtExplore">
    <button ref={trigger} type="button" className="rmtExploreTrigger" aria-haspopup="dialog" aria-expanded={open} onClick={show}>{MARKET_UNIVERSE_LABELS[scope]}<TerminalIcon name="chevron" /></button>
    <dialog ref={dialog} className="rmtExploreDialog" aria-labelledby="rmt-explore-heading" onCancel={close} onClick={e => { if (e.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
      <header><h2 id="rmt-explore-heading">Filter markets</h2><button type="button" aria-label="Close market filter" onClick={close}>×</button></header>
      {group("Markets", ["all", "projects", "rwa", "stock"])}
      {group("Your markets", ["held"])}
    </dialog>
  </div>;
}
