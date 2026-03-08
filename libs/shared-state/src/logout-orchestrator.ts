import { Injectable, inject } from '@angular/core';
import { LogoutSignal } from './logout-signal';

/**
 * Centralized logout orchestrator that collects reset functions from stores/services
 * and invokes them all on logout. Works alongside the existing LogoutSignal Subject
 * for stores that prefer the observable pattern.
 */
@Injectable({ providedIn: 'root' })
export class LogoutOrchestrator {
  private readonly logoutSignal = inject(LogoutSignal);
  private resetFns: (() => void)[] = [];

  register(resetFn: () => void): void {
    this.resetFns.push(resetFn);
  }

  unregister(resetFn: () => void): void {
    this.resetFns = this.resetFns.filter((fn) => fn !== resetFn);
  }

  resetAll(): void {
    // Emit to observable-based stores
    this.logoutSignal.emit();
    // Call registered reset functions (e.g. OnboardingStore)
    this.resetFns.forEach((fn) => fn());
  }
}
