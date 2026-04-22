import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { INITIATE_DEPOSIT } from '../graphql/investor-bff.mutations';
import { ON_DEPOSIT_EVENT } from '../graphql/investor-bff.subscriptions';

export interface DepositIntent {
  depositId: string;
  amountCents: number;
  currency: string;
  status: string;
  initiatedAt: string;
}

export interface DepositEvent {
  depositId: string;
  tenantId: string;
  status: 'INITIATED' | 'DETECTED' | 'FAILED';
  amountCents: number;
  currency: string;
  occurredAt: string;
  reason: string | null;
}

export interface DepositInput {
  amountCents: number;
  currency: string;
}

@Injectable()
export class DepositService {
  private readonly graphql = inject(GraphqlService);
  private subscription: Subscription | null = null;

  async initiateDeposit(input: DepositInput): Promise<DepositIntent> {
    const data = await this.graphql.mutate<{ initiateDeposit: DepositIntent }>(
      INITIATE_DEPOSIT,
      { input },
    );
    return data.initiateDeposit;
  }

  subscribeToDepositEvent(depositId: string, onEvent: (e: DepositEvent) => void): void {
    this.unsubscribeFromDepositEvent();
    const obs = this.graphql.subscribe<{ onDepositEvent: DepositEvent }>(
      ON_DEPOSIT_EVENT,
      { depositId },
    );
    this.subscription = obs.subscribe({
      next: (data) => {
        if (data.onDepositEvent) onEvent(data.onDepositEvent);
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
}
