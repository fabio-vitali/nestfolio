import type { MarketDataProvider, Quote, IndexData, RateData } from './market-data-client';

export class CachedMarketDataProvider implements MarketDataProvider {
  private readonly cache = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(
    private readonly delegate: MarketDataProvider,
    private readonly ttlMs: number = 60_000,
  ) {}

  async getQuote(symbol: string): Promise<Quote | null> {
    const cached = this.getFromCache<Quote | null>(`quote:${symbol}`);
    if (cached !== undefined) return cached;
    const result = await this.delegate.getQuote(symbol);
    this.setCache(`quote:${symbol}`, result);
    return result;
  }

  async getIndices(): Promise<IndexData[]> {
    const cached = this.getFromCache<IndexData[]>('indices');
    if (cached !== undefined) return cached;
    const result = await this.delegate.getIndices();
    this.setCache('indices', result);
    return result;
  }

  async getRates(): Promise<RateData[]> {
    const cached = this.getFromCache<RateData[]>('rates');
    if (cached !== undefined) return cached;
    const result = await this.delegate.getRates();
    this.setCache('rates', result);
    return result;
  }

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, expiresAt: Date.now() + this.ttlMs });
  }
}
