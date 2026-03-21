/** @jest-environment node */
import { CachedQuery } from '../../src/graphql/cached-query';

describe('CachedQuery', () => {
  let loader: jest.Mock;

  beforeEach(() => {
    loader = jest.fn().mockResolvedValue({ items: [1, 2, 3] });
    jest.spyOn(Date, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call loader on first get', async () => {
    const cq = new CachedQuery(loader, 60_000);

    const result = await cq.get();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('should return cached data within TTL', async () => {
    const cq = new CachedQuery(loader, 60_000);

    await cq.get();
    (Date.now as jest.Mock).mockReturnValue(30_000); // 29s later, within TTL
    const result = await cq.get();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('should refresh after TTL expires', async () => {
    const cq = new CachedQuery(loader, 60_000);

    await cq.get();
    loader.mockResolvedValue({ items: [4, 5] });
    (Date.now as jest.Mock).mockReturnValue(70_000); // 69s later, past TTL

    const result = await cq.get();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ items: [4, 5] });
  });

  it('should force refresh even within TTL', async () => {
    const cq = new CachedQuery(loader, 60_000);

    await cq.get();
    loader.mockResolvedValue({ items: [9] });

    const result = await cq.get(true);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ items: [9] });
  });

  it('should invalidate cache', async () => {
    const cq = new CachedQuery(loader, 60_000);

    await cq.get();
    cq.invalidate();
    loader.mockResolvedValue({ items: [7] });

    const result = await cq.get();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ items: [7] });
  });

  it('should dedup concurrent calls (in-flight sharing)', async () => {
    let resolveLoader!: (v: { items: number[] }) => void;
    loader.mockReturnValue(new Promise((res) => { resolveLoader = res; }));
    const cq = new CachedQuery(loader, 60_000);

    const p1 = cq.get();
    const p2 = cq.get();

    resolveLoader({ items: [1] });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ items: [1] });
    expect(r2).toEqual({ items: [1] });
  });

  it('should clear inflight on loader error', async () => {
    loader.mockRejectedValueOnce(new Error('fail'));
    const cq = new CachedQuery(loader, 60_000);

    await expect(cq.get()).rejects.toThrow('fail');

    // Next call should retry
    loader.mockResolvedValue({ items: [1] });
    const result = await cq.get();
    expect(result).toEqual({ items: [1] });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('should use default 60s TTL', async () => {
    const cq = new CachedQuery(loader);

    await cq.get();
    (Date.now as jest.Mock).mockReturnValue(50_000); // 49s — still within 60s
    await cq.get();
    expect(loader).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(62_000); // past 60s
    await cq.get();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
