await import("./all-foundation-smoke.ts");
await import("./human-authoritative-paper-execution-smoke.ts");
await import("./agent-authoritative-open-position-execution-smoke.ts");
await import("./paper-evaluation-close-smoke.ts");
await import("./agent-authoritative-position-reduction-smoke.ts");
await import("./paper-arena-roster-smoke.ts");
await import("./paper-arena-matchup-smoke.ts");
await import("./paper-arena-authoritative-matchup-smoke.ts");
await import("./paper-arena-public-read-model-smoke.ts");
await import("./paper-arena-season-finalization-smoke.ts");

console.log("\nagent foundation smoke runner v2: authoritative Human + Agent entry/close execution + durable Arena lifecycle through immutable season finalization included");
