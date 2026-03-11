import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { withLogoutReset } from '../../src/features/with-logout-reset';
import { LogoutOrchestrator } from '../../src/logout-orchestrator';

const TestStore = signalStore(
  { providedIn: 'root' },
  withState({ items: ['a', 'b'], count: 2 }),
  withMethods((store) => ({
    addItem(item: string) {
      patchState(store, { items: [...store.items(), item], count: store.count() + 1 });
    },
  })),
  withLogoutReset(() => ({ items: [] as string[], count: 0 })),
);

describe('withLogoutReset', () => {
  let store: InstanceType<typeof TestStore>;
  let orchestrator: LogoutOrchestrator;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TestStore);
    orchestrator = TestBed.inject(LogoutOrchestrator);
  });

  it('should register with LogoutOrchestrator on init', () => {
    // Store is already initialized, register was called
    // Re-inject to capture the spy (already called during first inject)
    // Verify indirectly: resetAll should reset state
    store.addItem('c');
    expect(store.items()).toEqual(['a', 'b', 'c']);

    orchestrator.resetAll();

    expect(store.items()).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('should reset state when LogoutOrchestrator.resetAll is called', () => {
    store.addItem('x');
    store.addItem('y');
    expect(store.count()).toBe(4);

    orchestrator.resetAll();

    expect(store.items()).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('should allow re-population after reset', () => {
    orchestrator.resetAll();
    expect(store.items()).toEqual([]);

    store.addItem('new');
    expect(store.items()).toEqual(['new']);
    expect(store.count()).toBe(1);
  });

  it('should handle multiple resets', () => {
    store.addItem('first');
    orchestrator.resetAll();
    expect(store.items()).toEqual([]);

    store.addItem('second');
    orchestrator.resetAll();
    expect(store.items()).toEqual([]);
  });
});
