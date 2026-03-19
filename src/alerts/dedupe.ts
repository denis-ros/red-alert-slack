export class MessageDeduper {
  private readonly seenAt = new Map<string, number>();

  constructor(
    private readonly maxEntries = 500,
    private readonly ttlMs = 20 * 60 * 1000
  ) {}

  hasSeen(key: string, nowMs = Date.now()): boolean {
    this.evictExpired(nowMs);

    const existing = this.seenAt.get(key);
    if (existing !== undefined) {
      return true;
    }

    this.seenAt.set(key, nowMs);
    if (this.seenAt.size > this.maxEntries) {
      const oldestKey = this.seenAt.keys().next().value;
      if (oldestKey) {
        this.seenAt.delete(oldestKey);
      }
    }

    return false;
  }

  private evictExpired(nowMs: number): void {
    for (const [key, seenMs] of this.seenAt) {
      if (nowMs - seenMs <= this.ttlMs) {
        continue;
      }

      this.seenAt.delete(key);
    }
  }
}

