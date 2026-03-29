import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverServices } from '../../tools/generate-c4-sources.mjs';

describe('discoverServices', () => {
  it('returns services grouped by domain', () => {
    const services = discoverServices();
    // Must find 4 domains
    const domains = [...new Set(services.map(s => s.domain))];
    assert.ok(domains.includes('investor'));
    assert.ok(domains.includes('advisory'));
    assert.ok(domains.includes('execution'));
    assert.ok(domains.includes('ledger'));
    // Must find known services
    const names = services.map(s => s.service);
    assert.ok(names.includes('investor-ctrl'));
    assert.ok(names.includes('dashboard-bff'));
    assert.ok(names.includes('broker-ctrl'));
    // Each entry has stackPath pointing to a real file
    for (const s of services) {
      assert.ok(s.stackPath.endsWith('service.stack.ts'));
    }
  });
});
