import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import {
  DepositService,
  type DepositEvent,
  type DepositIntent,
} from '../services/deposit.service';

export type DepositPageState =
  | 'form'
  | 'submitting'
  | 'initiated'
  | 'detected'
  | 'failed'
  | 'timeout';

const TIMEOUT_MS = 30_000;
const FEATURE_FLAG = 'initiateDeposit';

@Component({
  selector: 'app-deposit-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    InputNumberModule,
    MessageModule,
    TagModule,
  ],
  template: `
    <div class="deposit-page">
      <h1 class="page-title">Fund account</h1>

      @if (state() === 'form' || state() === 'submitting') {
        <p-card data-testid="deposit-form">
          @if (!flagEnabled()) {
            <p-message severity="warn"
              [text]="flagReason() || 'Deposits paused — the brokerage circuit is open.'"
              styleClass="w-full" />
          }
          <div class="field">
            <label for="amount">Amount</label>
            <p-inputNumber
              inputId="amount"
              data-testid="deposit-amount"
              [ngModel]="amount()"
              (ngModelChange)="amount.set($event)"
              mode="currency"
              currency="USD"
              locale="en-US"
              [min]="1"
              [max]="10000000"
              [disabled]="state() === 'submitting'" />
          </div>
          <div class="field">
            <label>Currency</label>
            <span data-testid="deposit-currency">USD</span>
          </div>
          <div class="actions">
            <p-button
              label="Cancel"
              severity="secondary"
              [outlined]="true"
              data-testid="deposit-cancel"
              [disabled]="state() === 'submitting'"
              (onClick)="cancel()" />
            <p-button
              label="Confirm"
              data-testid="deposit-confirm"
              [disabled]="confirmDisabled()"
              [loading]="state() === 'submitting'"
              (onClick)="submit()" />
          </div>
          @if (state() === 'submitting') {
            <div data-testid="deposit-submitting" class="spinner">Submitting…</div>
          }
        </p-card>
      }

      @if (state() === 'initiated') {
        <p-card data-testid="deposit-panel-initiated">
          <p-tag severity="info" value="INITIATED" />
          <p>Deposit ID: <code>{{ depositIntent()?.depositId }}</code></p>
          <p>Amount: {{ (depositIntent()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
          <p>We'll update this page the moment your deposit is confirmed.</p>
        </p-card>
      }

      @if (state() === 'timeout') {
        <p-card data-testid="deposit-panel-timeout">
          <p-tag severity="info" value="INITIATED" />
          <p-message severity="warn" text="Still processing… this can take up to a minute."
            styleClass="w-full" />
          <p>Deposit ID: <code>{{ depositIntent()?.depositId }}</code></p>
        </p-card>
      }

      @if (state() === 'detected') {
        <p-card data-testid="deposit-panel-detected">
          <p-tag severity="success" value="DETECTED" />
          <p>Deposit ID: <code>{{ depositIntent()?.depositId }}</code></p>
          <p>Amount: {{ (depositEvent()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
          <p>Confirmed at: {{ depositEvent()?.occurredAt }}</p>
          <p-button
            label="View on dashboard"
            data-testid="deposit-back"
            (onClick)="viewDashboard()" />
        </p-card>
      }

      @if (state() === 'failed') {
        <p-card data-testid="deposit-panel-failed">
          <p-tag severity="danger" value="FAILED" />
          <p-message severity="error" [text]="failureReason() ?? 'Deposit failed'"
            styleClass="w-full" />
          <p-button label="Try again" (onClick)="tryAgain()" />
        </p-card>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .deposit-page { max-width: 28rem; margin: 2rem auto; padding: 0 1rem; }
    .page-title { margin: 0 0 1rem; font-size: 1.25rem; font-weight: 700; }
    .field { margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
    .field label { font-size: 0.75rem; color: var(--nf-text-secondary, #6c757d);
      text-transform: uppercase; letter-spacing: 0.04em; }
    .actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    .spinner { margin-top: 0.5rem; color: var(--nf-text-secondary, #6c757d); }
    .w-full { width: 100%; }
  `],
})
export class DepositPageComponent implements OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly deposit = inject(DepositService);
  private readonly flagsStore = inject(FeatureFlagsStore);

  readonly state = signal<DepositPageState>('form');
  readonly amount = signal<number | null>(null);
  readonly depositIntent = signal<DepositIntent | null>(null);
  readonly depositEvent = signal<DepositEvent | null>(null);
  readonly failureReason = signal<string | null>(null);

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  readonly flagEnabled = computed(() => this.flagsStore.isEnabled(FEATURE_FLAG));
  readonly flagReason = computed(() => this.flagsStore.flags()[FEATURE_FLAG]?.reason ?? null);

  readonly confirmDisabled = computed(() => {
    const a = this.amount();
    if (a == null || a <= 0) return true;
    if (!this.flagEnabled()) return true;
    return this.state() === 'submitting';
  });

  async submit(): Promise<void> {
    if (this.confirmDisabled()) return;
    this.state.set('submitting');
    this.failureReason.set(null);
    try {
      const intent = await this.deposit.initiateDeposit({
        amountCents: Math.round((this.amount() ?? 0) * 100),
        currency: 'USD',
      });
      this.depositIntent.set(intent);
      this.state.set('initiated');
      this.armTimeout();
      this.deposit.subscribeToDepositEvent(intent.depositId, (event) => this.onEvent(event));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed';
      this.failureReason.set(message);
      this.state.set('failed');
    }
  }

  private onEvent(event: DepositEvent): void {
    this.depositEvent.set(event);
    this.clearTimeout();
    if (event.status === 'DETECTED') {
      this.state.set('detected');
    } else if (event.status === 'FAILED') {
      this.failureReason.set(event.reason ?? 'Deposit failed');
      this.state.set('failed');
    }
  }

  private armTimeout(): void {
    this.clearTimeout();
    this.timeoutHandle = setTimeout(() => {
      if (this.state() === 'initiated') this.state.set('timeout');
    }, TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  cancel(): void {
    this.router.navigate(['/dashboard']);
  }

  tryAgain(): void {
    this.clearTimeout();
    this.deposit.unsubscribeFromDepositEvent();
    this.depositIntent.set(null);
    this.depositEvent.set(null);
    this.failureReason.set(null);
    this.state.set('form');
  }

  viewDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.clearTimeout();
    this.deposit.unsubscribeFromDepositEvent();
  }
}
