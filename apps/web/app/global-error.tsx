"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RMT:global] client recovery activated", {
      error: error.name,
      digest: error.digest ?? "unavailable"
    });
  }, [error.digest, error.name]);

  return (
    <html lang="en">
      <body className="rmtGlobalRecovery">
        <main>
          <img src="/brand/rmt-master-logo.png" alt="" />
          <p>RMT RECOVERY</p>
          <h1>Your funds and wallet remain untouched.</h1>
          <span>RMT stopped a failed browser session before it could continue. Start a fresh session to return to the terminal.</span>
          <div>
            <button type="button" onClick={reset}>Try again</button>
            <button type="button" onClick={() => window.location.assign("/")}>Open terminal</button>
          </div>
          <small>If this repeats, send RMT the time shown on your phone. Never send a recovery phrase or private key.</small>
        </main>
        <style>{`
          .rmtGlobalRecovery { margin: 0; min-height: 100dvh; color: #f4fff6; background: radial-gradient(circle at 20% 0%, #0d311a 0, #060906 38%); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          .rmtGlobalRecovery main { min-height: 100dvh; box-sizing: border-box; display: grid; place-content: center; gap: 16px; max-width: 620px; margin: auto; padding: 32px 24px; }
          .rmtGlobalRecovery img { width: 58px; height: 58px; border-radius: 15px; }
          .rmtGlobalRecovery p { margin: 0; color: #4cf17b; font: 800 12px/1.2 ui-monospace, SFMono-Regular, monospace; letter-spacing: .16em; }
          .rmtGlobalRecovery h1 { margin: 0; font-size: clamp(32px, 8vw, 54px); line-height: .98; }
          .rmtGlobalRecovery span, .rmtGlobalRecovery small { color: #aab6ad; line-height: 1.55; }
          .rmtGlobalRecovery div { display: flex; gap: 10px; flex-wrap: wrap; }
          .rmtGlobalRecovery button { min-height: 48px; padding: 0 20px; border: 1px solid #2a5e38; border-radius: 14px; color: #061008; background: #4cf17b; font: 800 15px/1 system-ui, sans-serif; }
          .rmtGlobalRecovery button + button { color: #dce9df; background: #0b130d; }
        `}</style>
      </body>
    </html>
  );
}
