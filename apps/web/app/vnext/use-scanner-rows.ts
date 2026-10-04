"use client";
import { useEffect, useRef, useState } from "react";
import { reconcileScannerRows } from "../../lib/vnext/scanner-reconciliation";

/** Shared interaction policy; identity and component keys remain unchanged. */
export function useScannerRows<T>(rows: readonly T[], key: (row: T) => string, context: string, retainPagedRows = false, eligibleRows: readonly T[] = rows) {
  const [anchor, setAnchor] = useState({ context, ids: rows.map(key) });
  const [holding, setHolding] = useState(false);
  const latest = useRef({ rows, key, context });
  latest.current = { rows, key, context };
  const displayed = useRef(anchor);
  const displayedRows = useRef({ context, rows });
  const pointer = useRef(false);
  const interaction = useRef(false);
  const scrollContainer = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const typing = document.activeElement?.matches("input,textarea,[contenteditable=true]");
      const hold = pointer.current || interaction.current || window.scrollY > 32 || (scrollContainer.current?.scrollTop ?? 0) > 32 || Boolean(typing);
      if (hold) setAnchor(displayed.current);
      setHolding(hold);
    };
    const busy = (e: Event) => {
      if (e.type === "scroll" && e.target instanceof HTMLElement && e.target.scrollHeight > e.target.clientHeight) scrollContainer.current = e.target;
      if (e.type === "pointerdown") pointer.current = true;
      interaction.current = true;
      clearTimeout(timer);
      update();
      timer = setTimeout(() => { interaction.current = false; update(); }, 1_500);
    };
    const up = () => { pointer.current = false; busy(new Event("idle")); };
    const blur = () => queueMicrotask(update);
    window.addEventListener("scroll", busy, true);
    window.addEventListener("pointerdown", busy);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", blur);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", busy, true);
      window.removeEventListener("pointerdown", busy);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", blur);
    };
  }, []);
  useEffect(() => {
    if (!holding || anchor.context !== context) {
      const ids = rows.map(key);
      setAnchor(current => current.context === context && current.ids.join("|") === ids.join("|") ? current : { context, ids });
    }
  }, [rows, key, context, holding, anchor.context]);
  const result = reconcileScannerRows(rows, anchor.ids, key, holding && anchor.context === context,
    retainPagedRows && displayedRows.current.context === context ? displayedRows.current.rows : [], eligibleRows);
  displayed.current = { context, ids: result.rows.map(key) };
  displayedRows.current = { context, rows: result.rows };
  const showUpdates = () => {
    const next = latest.current;
    window.scrollTo({ top: 0, behavior: "instant" });
    scrollContainer.current?.scrollTo({ top: 0, behavior: "instant" });
    interaction.current = false;
    setHolding(false);
    setAnchor({ context: next.context, ids: next.rows.map(next.key) });
  };
  return { ...result, showUpdates };
}
