import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { type Type, type Provider } from '@angular/core';

export function createMockGraphqlService() {
  return {
    query: jest.fn(),
    mutate: jest.fn(),
    subscribe: jest.fn(),
    resetClient: jest.fn(),
  };
}

export function createMockI18nService() {
  return { t: (key: string) => key, instant: (key: string) => key };
}

export function createMockRouter() {
  return { navigate: jest.fn().mockResolvedValue(true), createUrlTree: jest.fn() };
}

export async function setupComponentTest<T>(
  component: Type<T>,
  config: {
    providers?: Provider[];
    imports?: any[];
    /**
     * Provide a template string to replace the component template in the test.
     * Defaults to `'<div>test</div>'` (stub) for backward compatibility.
     * Pass `null` to render the component's REAL template (use when the test
     * needs to assert on rendered DOM elements).
     */
    overrideTemplate?: string | null;
  } = {},
): Promise<ComponentFixture<T>> {
  const module = TestBed.configureTestingModule({
    imports: [component, ...(config.imports ?? [])],
    providers: config.providers ?? [],
  });

  const templateOverride =
    config.overrideTemplate === undefined ? '<div>test</div>' : config.overrideTemplate;

  if (templateOverride !== null) {
    module.overrideComponent(component, {
      set: {
        template: templateOverride,
        imports: [],
        styles: [],
      },
    });
  }

  await module.compileComponents();

  return TestBed.createComponent(component);
}
