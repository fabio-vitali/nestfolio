jest.mock('@angular/core', () => ({
  InjectionToken: class InjectionToken {
    constructor(private desc: string) {}
    toString() { return `InjectionToken ${this.desc}`; }
  },
}));

import { APPSYNC_CONFIG } from '../src/appsync.config';

describe('APPSYNC_CONFIG', () => {
  it('is an InjectionToken with description', () => {
    expect(APPSYNC_CONFIG).toBeDefined();
    expect(APPSYNC_CONFIG.toString()).toContain('APPSYNC_CONFIG');
  });
});
