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
    overrideTemplate?: string;
  } = {},
): Promise<ComponentFixture<T>> {
  await TestBed.configureTestingModule({
    imports: [component, ...(config.imports ?? [])],
    providers: config.providers ?? [],
  })
    .overrideComponent(component, {
      set: {
        template: config.overrideTemplate ?? '<div>test</div>',
        imports: [],
        styles: [],
      },
    })
    .compileComponents();

  return TestBed.createComponent(component);
}
