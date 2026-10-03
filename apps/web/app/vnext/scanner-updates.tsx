"use client";
export function ScannerUpdates({ pending, newCount, onShow }: { pending: boolean; newCount: number; onShow: () => void }) {
  return <div className="rmtScannerUpdates" aria-live="polite">{pending ? <button type="button" onClick={onShow}>↑ {newCount ? `${newCount} new ${newCount === 1 ? "result" : "results"}` : "Ranking updated"} · show updates</button> : null}</div>;
}
