import { TestBed } from '@angular/core/testing';
import { UiStore } from './ui.store';

describe('UiStore', () => {
  let store: InstanceType<typeof UiStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(UiStore);
  });

  it('should start with default values', () => {
    expect(store.theme()).toBe('light');
    expect(store.locale()).toBe('it-IT');
    expect(store.loading()).toBe(false);
  });

  it('should set theme', () => {
    store.setTheme('dark');
    expect(store.theme()).toBe('dark');
  });

  it('should toggle theme', () => {
    store.toggleTheme();
    expect(store.theme()).toBe('dark');
    store.toggleTheme();
    expect(store.theme()).toBe('light');
  });

  it('should set locale', () => {
    store.setLocale('en-GB');
    expect(store.locale()).toBe('en-GB');
  });

  it('should set loading', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);
  });
});
