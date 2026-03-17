import { handler } from '../../src/handlers/tools/instrument-universe.handler';

describe('instrument-universe tool handler', () => {
  it('should return full approved instrument list', async () => {
    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.instruments.length).toBeGreaterThan(0);
    expect(body.count).toBe(body.instruments.length);
    expect(body.instruments[0]).toHaveProperty('ticker');
    expect(body.instruments[0]).toHaveProperty('name');
    expect(body.instruments[0]).toHaveProperty('assetClass');
    expect(body.instruments[0]).toHaveProperty('region');
    expect(body.timestamp).toBeDefined();
  });

  it('should filter instruments by asset class', async () => {
    const result = await handler({ assetClass: 'fixed-income' });
    const body = JSON.parse(result.body);

    expect(body.instruments.length).toBeGreaterThan(0);
    body.instruments.forEach((i: any) => {
      expect(i.assetClass).toBe('fixed-income');
    });
  });

  it('should return empty list for non-existent asset class', async () => {
    const result = await handler({ assetClass: 'crypto' });
    const body = JSON.parse(result.body);

    expect(body.instruments).toHaveLength(0);
    expect(body.count).toBe(0);
  });
});
