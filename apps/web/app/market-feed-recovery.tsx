"use client";

export function MarketFeedRecovery() {
  return (
    <section className="marketFeedRecovery" role="status" aria-live="polite">
      <p className="eyebrow">LIVE MARKET RECOVERY</p>
      <h2>The terminal stayed online</h2>
      <p>Live rankings paused before they could affect the rest of RMT. Reload this section to request a fresh market session.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload live markets</button>
    </section>
  );
}
