export function nowUnixSeconds(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function boundedBackoffDelay(attempt: number, maxMs: number): number {
  const jitter = Math.floor(Math.random() * 250);
  const base = Math.min(500 * 2 ** attempt, maxMs);
  return base + jitter;
}

