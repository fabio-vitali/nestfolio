import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createMockGraphqlService, createMockI18nService, createMockRouter, setupComponentTest } from './index';

describe('createMockGraphqlService', () => {
  it('returns mock with all methods as jest.fn()', () => {
    const mock = createMockGraphqlService();
    expect(typeof mock.query).toBe('function');
    expect(typeof mock.mutate).toBe('function');
    expect(typeof mock.subscribe).toBe('function');
    expect(typeof mock.resetClient).toBe('function');
  });
});

describe('createMockI18nService', () => {
  it('returns identity functions for t and instant', () => {
    const mock = createMockI18nService();
    expect(mock.t('some.key')).toBe('some.key');
    expect(mock.instant('other.key')).toBe('other.key');
  });
});

describe('createMockRouter', () => {
  it('returns mock with navigate and createUrlTree', () => {
    const mock = createMockRouter();
    expect(typeof mock.navigate).toBe('function');
    expect(typeof mock.createUrlTree).toBe('function');
  });

  it('navigate resolves to true', async () => {
    const mock = createMockRouter();
    await expect(mock.navigate!(['/home'])).resolves.toBe(true);
  });
});

describe('setupComponentTest', () => {
  @Component({ selector: 'test-cmp', standalone: true, template: '<p>Original</p>' })
  class TestComponent {
    value = 'hello';
  }

  it('creates component fixture with overridden template', async () => {
    const fixture = await setupComponentTest(TestComponent);
    expect(fixture.componentInstance.value).toBe('hello');
    expect(fixture.nativeElement.textContent).toContain('test');
  });

  it('allows custom override template', async () => {
    const fixture = await setupComponentTest(TestComponent, {
      overrideTemplate: '<span>custom</span>',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('custom');
  });
});
