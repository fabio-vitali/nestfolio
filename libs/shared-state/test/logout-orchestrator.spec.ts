import { TestBed } from '@angular/core/testing';
import { LogoutOrchestrator } from '../src/logout-orchestrator';

describe('LogoutOrchestrator', () => {
  let orchestrator: LogoutOrchestrator;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    orchestrator = TestBed.inject(LogoutOrchestrator);
  });

  it('should call all registered reset functions on resetAll', () => {
    const resetFn1 = jest.fn();
    const resetFn2 = jest.fn();
    orchestrator.register(resetFn1);
    orchestrator.register(resetFn2);

    orchestrator.resetAll();

    expect(resetFn1).toHaveBeenCalledTimes(1);
    expect(resetFn2).toHaveBeenCalledTimes(1);
  });

  it('should not call unregistered functions', () => {
    const resetFn = jest.fn();
    orchestrator.register(resetFn);
    orchestrator.unregister(resetFn);

    orchestrator.resetAll();

    expect(resetFn).not.toHaveBeenCalled();
  });
});
