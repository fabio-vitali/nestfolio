import { Injectable } from '@angular/core';
import { type AuthTokens, getAuthSession, forceRefreshSession } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthInterceptorState {
  private inflightSession: Promise<AuthTokens | null> | null = null;
  private isRetrying = false;

  getSharedSession(): Promise<AuthTokens | null> {
    if (!this.inflightSession) {
      this.inflightSession = getAuthSession().finally(() => {
        this.inflightSession = null;
      });
    }
    return this.inflightSession;
  }

  startRetry(): boolean {
    if (this.isRetrying) return false;
    this.isRetrying = true;
    return true;
  }

  endRetry(): void {
    this.isRetrying = false;
  }

  reset(): void {
    this.inflightSession = null;
    this.isRetrying = false;
  }
}
