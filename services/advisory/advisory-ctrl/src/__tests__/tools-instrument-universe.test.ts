jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { handler } from '../handlers/tools/instrument-universe';

describe('instrument-universe tool handler', () => {
  it('should return approved instruments list', async () => {
    const result = (await handler({})) as { instruments: unknown[] };

    expect(result.instruments).toBeDefined();
    expect(result.instruments.length).toBeGreaterThan(0);
  });

  it('should include correct instrument structure', async () => {
    const result = (await handler({})) as { instruments: Array<{ ticker: string; name: string; assetClass: string; region: string }> };

    for (const inst of result.instruments) {
      expect(inst).toEqual(
        expect.objectContaining({
          ticker: expect.any(String),
          name: expect.any(String),
          assetClass: expect.any(String),
          region: expect.any(String),
        }),
      );
    }
  });

  it('should include VTI in the universe', async () => {
    const result = (await handler({})) as { instruments: Array<{ ticker: string }> };

    const vti = result.instruments.find((i) => i.ticker === 'VTI');
    expect(vti).toBeDefined();
  });
});
