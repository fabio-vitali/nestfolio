jest.mock('@angular-architects/native-federation', () => ({
  loadRemoteModule: jest.fn(),
}));

import { loadRemoteModule } from '@angular-architects/native-federation';
import type { Routes } from '@angular/router';
import { loadMfe } from '../../src/app/app.routes';
import { MfeErrorComponent } from '../../src/app/mfe-error.component';

const mockedLoadRemoteModule = loadRemoteModule as jest.MockedFunction<typeof loadRemoteModule>;

describe('loadMfe()', () => {
  beforeEach(() => {
    mockedLoadRemoteModule.mockReset();
  });

  it('unwraps m.remoteRoutes and returns a Routes array on success', async () => {
    const fakeRoutes: Routes = [
      { path: 'foo', loadComponent: async () => class FakeComponent {} },
    ];
    mockedLoadRemoteModule.mockResolvedValue({ remoteRoutes: fakeRoutes });

    const resolver = loadMfe('investor-mfe', './routes');
    const result = await resolver();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(fakeRoutes);
  });

  it('returns the MfeErrorComponent fallback Routes array on failure', async () => {
    mockedLoadRemoteModule.mockRejectedValue(new Error('remote unreachable'));

    const resolver = loadMfe('investor-mfe', './routes');
    const result = await resolver();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ path: '**', component: MfeErrorComponent }]);
  });

  it('always returns a Routes array, never an object wrapper', async () => {
    mockedLoadRemoteModule.mockResolvedValue({ remoteRoutes: [] });
    const resolverOk = loadMfe('investor-mfe', './routes');
    expect(Array.isArray(await resolverOk())).toBe(true);

    mockedLoadRemoteModule.mockRejectedValue(new Error('boom'));
    const resolverErr = loadMfe('investor-mfe', './routes');
    expect(Array.isArray(await resolverErr())).toBe(true);
  });
});
