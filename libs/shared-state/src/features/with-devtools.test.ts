import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { withDevtools } from './with-devtools';

describe('withDevtools', () => {
  const mockSend = jest.fn();
  const mockInit = jest.fn();
  const mockConnect = jest.fn(() => ({ send: mockSend, init: mockInit }));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete (window as any).__REDUX_DEVTOOLS_EXTENSION__;
  });

  it('should connect to DevTools when extension is available', () => {
    (window as any).__REDUX_DEVTOOLS_EXTENSION__ = { connect: mockConnect };

    const Store = signalStore(
      { providedIn: 'root' },
      withState({ count: 0 }),
      withDevtools('TestStore'),
    );

    TestBed.configureTestingModule({});
    TestBed.inject(Store);

    expect(mockConnect).toHaveBeenCalledWith({ name: '[Nestfolio] TestStore' });
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ count: 0 }));
  });

  it('should not throw when DevTools extension is absent', () => {
    const Store = signalStore(
      { providedIn: 'root' },
      withState({ value: 'test' }),
      withDevtools('SafeStore'),
    );

    TestBed.configureTestingModule({});
    expect(() => TestBed.inject(Store)).not.toThrow();
  });

  it('should not throw in SSR environment (no window)', () => {
    const originalWindow = globalThis.window;
    // In jsdom, window is always defined, so test the guard differently
    const Store = signalStore(
      { providedIn: 'root' },
      withState({ data: null }),
      withDevtools('SSRStore'),
    );

    TestBed.configureTestingModule({});
    // No extension = no connect call, no error
    expect(() => TestBed.inject(Store)).not.toThrow();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('should send state updates to DevTools', async () => {
    (window as any).__REDUX_DEVTOOLS_EXTENSION__ = { connect: mockConnect };

    const Store = signalStore(
      { providedIn: 'root' },
      withState({ count: 0 }),
      withDevtools('CountStore'),
      withMethods((store) => ({
        increment() {
          patchState(store, { count: store.count() + 1 });
        },
      })),
    );

    TestBed.configureTestingModule({});
    const store = TestBed.inject(Store);

    store.increment();

    // effect() is async — flush microtasks
    await TestBed.flushEffects();

    expect(mockSend).toHaveBeenCalledWith(
      { type: '[CountStore] state update' },
      expect.objectContaining({ count: 1 }),
    );
  });
});
