import { Injectable } from '@angular/core';

/**
 * Centralized logout orchestrator that collects reset functions from stores/services
 * and invokes them all on logout. Stores register via withLogoutReset() feature;
 * services register in their constructor.
 */
@Injectable({ providedIn: 'root' })
export class LogoutOrchestrator {
  private resetFns: (() => void)[] = [];

  register(resetFn: () => void): void {
    this.resetFns.push(resetFn);
  }

  unregister(resetFn: () => void): void {
    this.resetFns = this.resetFns.filter((fn) => fn !== resetFn);
  }

  resetAll(): void {
    this.resetFns.forEach((fn) => fn());
  }
}
