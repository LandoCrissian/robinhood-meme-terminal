// One shared quota authority for every 0x call made by an RMT Next server.
// This source change does not deploy or change any existing production instance.
export async function register() {
  // Keep the import inside Next's documented positive runtime branch so the
  // Edge compiler never resolves Node crypto, even though this hook is shared.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const runtime = globalThis as typeof globalThis & { __rmtSharedZeroXQuotaV1?: typeof fetch };
    if (runtime.__rmtSharedZeroXQuotaV1) return;
    const { createSharedZeroXFetch } = await import("./lib/server/zero-x-shared-quota");
    const guarded = createSharedZeroXFetch(globalThis.fetch, () => process.env);
    runtime.__rmtSharedZeroXQuotaV1 = guarded;
    globalThis.fetch = guarded;
  }
}
