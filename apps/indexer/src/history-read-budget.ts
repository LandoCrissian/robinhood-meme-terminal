export function createHistoryReadBudget(now: () => number = Date.now) {
  const burst = 12;
  const ratePerSecond = 2;
  const maxConcurrent = 4;
  let available = burst;
  let lastRefill = now();
  let inFlight = 0;

  return {
    acquire() {
      const current = now();
      available = Math.min(burst, available + Math.max(0, current - lastRefill) * ratePerSecond / 1_000);
      lastRefill = Math.max(lastRefill, current);
      if (available < 1 || inFlight >= maxConcurrent) return null;
      available -= 1;
      inFlight += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight -= 1;
      };
    }
  };
}
