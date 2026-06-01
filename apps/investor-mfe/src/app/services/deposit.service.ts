import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { INITIATE_DEPOSIT } from '../graphql/investor-bff.mutations';
import { GET_DEPOSIT } from '../graphql/investor-bff.queries';
import { ON_DEPOSIT_UPDATE } from '../graphql/investor-bff.subscriptions';

export interface Deposit {
  depositId: string;
  amountCents: number;
  currency: string;
  status: string;
  initiatedAt: string;
  detectedAt: string | null;
  failedAt: string | null;
  reason: string | null;
}

export interface DepositEvent {
  depositId: string;
  status: 'INITIATED' | 'REQUESTED' | 'DETECTED' | 'SETTLED' | 'FAILED';
  amountCents: number;
  currency: string;
  occurredAt: string;
  reason: string | null;
}

// Raw onDepositUpdate subscription payload (BFF DepositUpdate type).
interface DepositUpdatePayload {
  depositId: string;
  status: string;
  amountCents: number;
  currency: string;
  detectedAt: string | null;
  settledAt: string | null;
  failedAt: string | null;
  reason: string | null;
}

export interface DepositInput {
  depositId: string;
  amountCents: number;
  currency: string;
}

export class DepositNotFoundError extends Error {
  constructor() { super('Deposit not found'); this.name = 'DepositNotFoundError'; }
}

const SUBSCRIPTION_HANDSHAKE_MS = 500;

@Injectable()
export class DepositService {
  private readonly graphql = inject(GraphqlService);
  private subscription: Subscription | null = null;

  async initiateDeposit(input: DepositInput): Promise<Deposit> {
    const data = await this.graphql.mutate<{ initiateDeposit: Deposit }>(INITIATE_DEPOSIT, { input });
    return data.initiateDeposit;
  }

  async getDeposit(depositId: string): Promise<Deposit> {
    try {
      const data = await this.graphql.query<{ getDeposit: Deposit }>(GET_DEPOSIT, { depositId });
      return data.getDeposit;
    } catch (err) {
      if (isNotFoundError(err)) throw new DepositNotFoundError();
      throw err;
    }
  }

  subscribeToDepositEvent(depositId: string, onEvent: (e: DepositEvent) => void): void {
    this.unsubscribeFromDepositEvent();
    const obs = this.graphql.subscribe<{ onDepositUpdate: DepositUpdatePayload }>(
      ON_DEPOSIT_UPDATE,
      { depositId },
    );
    this.subscription = obs.subscribe({
      next: (data) => {
        const u = data.onDepositUpdate;
        if (!u) return;
        onEvent({
          depositId: u.depositId,
          status: u.status as DepositEvent['status'],
          amountCents: u.amountCents,
          currency: u.currency,
          occurredAt: u.detectedAt ?? u.settledAt ?? u.failedAt ?? '',
          reason: u.reason ?? null,
        });
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Deposit subscription error', err);
      },
    });
  }

  unsubscribeFromDepositEvent(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  waitForSubscriptionReady(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SUBSCRIPTION_HANDSHAKE_MS));
  }
}

function isNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    const errorType = (err as Error & { errorType?: string }).errorType;
    if (errorType === 'NotFoundError') return true;
    if (/Deposit not found/i.test(err.message)) return true;
  }
  return false;
}
