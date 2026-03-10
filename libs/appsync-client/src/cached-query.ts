/**
 * Service-level query cache with TTL and in-flight dedup.
 * Use `invalidate()` on logout or after mutations that affect cached data.
 */
export class CachedQuery<T> {
  private cache: { data: T; timestamp: number } | null = null;
  private inflight: Promise<T> | null = null;

  constructor(
    private readonly loader: () => Promise<T>,
    private readonly ttlMs: number = 60_000,
  ) {}

  async get(forceRefresh = false): Promise<T> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.ttlMs) {
      return this.cache.data;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.loader()
      .then((data) => {
        this.cache = { data, timestamp: Date.now() };
        return data;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  invalidate(): void {
    this.cache = null;
  }
}
