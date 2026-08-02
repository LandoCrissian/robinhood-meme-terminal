import type { MarketIndexerConfig } from "./config.js";

export type PositionGuardHeartbeatStatus = {
  enabled: boolean;
  running: boolean;
  cycleSequence: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

type Fetch = typeof fetch;

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

export class PositionGuardHeartbeat {
  readonly status: PositionGuardHeartbeatStatus;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly configuration: MarketIndexerConfig["positionGuardEvaluator"],
    private readonly request: Fetch = fetch
  ) {
    this.status = {
      enabled: configuration !== null,
      running: false,
      cycleSequence: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null
    };
  }

  async tick() {
    if (!this.configuration || this.status.running || this.stopped) return;
    this.status.running = true;
    this.status.cycleSequence += 1;
    this.status.lastAttemptAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.request(this.configuration.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.configuration.token}`,
          "content-type": "application/json"
        },
        body: "{}",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`evaluator returned HTTP ${response.status}`);
      this.status.lastSuccessAt = new Date().toISOString();
      this.status.lastError = null;
    } catch (error) {
      this.status.lastError = errorText(error);
    } finally {
      clearTimeout(timeout);
      this.status.running = false;
    }
  }

  start() {
    const configuration = this.configuration;
    if (!configuration) return;
    const schedule = async () => {
      if (this.stopped) return;
      await this.tick();
      if (!this.stopped) {
        this.timer = setTimeout(schedule, configuration.intervalMs);
      }
    };
    void schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
