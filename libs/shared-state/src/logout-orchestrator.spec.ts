import { TestBed } from '@angular/core/testing';
import { LogoutOrchestrator } from './logout-orchestrator';
import { LogoutSignal } from './logout-signal';

describe('LogoutOrchestrator', () => {
  let orchestrator: LogoutOrchestrator;
  let logoutSignal: LogoutSignal;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    orchestrator = TestBed.inject(LogoutOrchestrator);
    logoutSignal = TestBed.inject(LogoutSignal);
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

  it('should emit LogoutSignal on resetAll', () => {
    const emitSpy = jest.spyOn(logoutSignal.logout$, 'next');

    orchestrator.resetAll();

    expect(emitSpy).toHaveBeenCalled();
  });

  it('should not call unregistered functions', () => {
    const resetFn = jest.fn();
    orchestrator.register(resetFn);
    orchestrator.unregister(resetFn);

    orchestrator.resetAll();

    expect(resetFn).not.toHaveBeenCalled();
  });
});
