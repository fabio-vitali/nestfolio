import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import { withCallState, setLoading, setLoaded, setError } from './with-call-state';

const TestStore = signalStore(
  { providedIn: 'root' },
  withCallState(),
  withMethods((store) => ({
    load() {
      patchState(store, setLoading());
    },
    succeed() {
      patchState(store, setLoaded());
    },
    fail(msg: string) {
      patchState(store, setError(msg));
    },
  })),
);

describe('withCallState', () => {
  let store: InstanceType<typeof TestStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TestStore);
  });

  it('should start in init state', () => {
    expect(store.callState()).toBe('init');
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should transition to loading', () => {
    store.load();
    expect(store.callState()).toBe('loading');
    expect(store.loading()).toBe(true);
    expect(store.loaded()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should transition to loaded', () => {
    store.load();
    store.succeed();
    expect(store.callState()).toBe('loaded');
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(true);
    expect(store.error()).toBeNull();
  });

  it('should transition to error with message', () => {
    store.load();
    store.fail('Something went wrong');
    expect(store.callState()).toBe('error');
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(false);
    expect(store.error()).toBe('Something went wrong');
  });

  it('should clear error when loading again', () => {
    store.fail('Old error');
    store.load();
    expect(store.error()).toBeNull();
    expect(store.loading()).toBe(true);
  });

  it('should clear error when loaded', () => {
    store.fail('Error');
    store.succeed();
    expect(store.error()).toBeNull();
    expect(store.loaded()).toBe(true);
  });
});

describe('patcher functions', () => {
  it('setLoading returns correct patch', () => {
    expect(setLoading()).toEqual({ callState: 'loading', callError: null });
  });

  it('setLoaded returns correct patch', () => {
    expect(setLoaded()).toEqual({ callState: 'loaded', callError: null });
  });

  it('setError returns correct patch with message', () => {
    expect(setError('fail')).toEqual({ callState: 'error', callError: 'fail' });
  });
});
