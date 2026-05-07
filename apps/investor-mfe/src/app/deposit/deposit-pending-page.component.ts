import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  DepositService,
  DepositNotFoundError,
  type Deposit,
  type DepositEvent,
} from '../services/deposit.service';

export type PendingPageState =
  | 'loading'
  | 'initiated'
  | 'detected'
  | 'failed'
  | 'timeout'
  | 'invalidUrl';

const TIMEOUT_MS = 30_000;

interface RouterFormState {
  amountCents?: number;
  currency?: string;
}

@Component({
  selector: 'app-deposit-pending-page',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, MessageModule, TagModule],
  template: `
    <div class="deposit-page">
      <h1 class="page-title">Fund account</h1>

      @if (state() === 'loading') {
        <p-card data-testid="deposit-panel-loading">
          <div class="spinner">Loading…</div>
        </p-card>
      }

      @if (state() === 'initiated') {
        <p-card data-testid="deposit-panel-initiated">
          <p-tag severity="info" value="INITIATED" />
          <p>Deposit ID: <code>{{ deposit()?.depositId }}</code></p>
          <p>Amount: {{ (deposit()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
          <p>We'll update this page the moment your deposit is confirmed.</p>
        </p-card>
      }

      @if (state() === 'timeout') {
        <p-card data-testid="deposit-panel-timeout">
          <p-tag severity="info" value="INITIATED" />
          <p-message severity="warn" text="Still processing… this can take up to a minute."
            styleClass="w-full" />
          <p>Deposit ID: <code>{{ deposit()?.depositId }}</code></p>
        </p-card>
      }

      @if (state() === 'detected') {
        <p-card data-testid="deposit-panel-detected">
          <p-tag severity="success" value="DETECTED" />
          <p>Deposit ID: <code>{{ deposit()?.depositId }}</code></p>
          <p>Amount: {{ (deposit()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
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
          <p-button label="Try again" data-testid="deposit-try-again" (onClick)="tryAgain()" />
        </p-card>
      }

      @if (state() === 'invalidUrl') {
        <p-card data-testid="deposit-panel-invalid-url">
          <p-message severity="error"
            text="We can't find this deposit. It may have been removed or the link is invalid."
            styleClass="w-full" />
          <p-button label="New deposit" data-testid="deposit-new" (onClick)="newDeposit()" />
        </p-card>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .deposit-page { max-width: 28rem; margin: 2rem auto; padding: 0 1rem; }
    .page-title { margin: 0 0 1rem; font-size: 1.25rem; font-weight: 700; }
    .spinner { color: var(--nf-text-secondary, #6c757d); }
    .w-full { width: 100%; }
  `],
})
export class DepositPendingPageComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly depositService = inject(DepositService);

  readonly state = signal<PendingPageState>('loading');
  readonly deposit = signal<Deposit | null>(null);
  readonly failureReason = signal<string | null>(null);

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    const depositId = this.route.snapshot.paramMap.get('depositId');
    if (!depositId) { this.state.set('invalidUrl'); return; }

    this.depositService.subscribeToDepositEvent(depositId, (e) => this.onEvent(e));

    try {
      await this.depositService.waitForSubscriptionReady();
    } catch {
      this.failureReason.set('Couldn\'t connect to server');
      this.state.set('failed');
      return;
    }

    let row: Deposit;
    try {
      row = await this.depositService.getDeposit(depositId);
    } catch (err) {
      if (!(err instanceof DepositNotFoundError)) {
        this.failureReason.set(err instanceof Error ? err.message : 'Could not load deposit');
        this.state.set('failed');
        return;
      }
      const navState = (history.state ?? {}) as RouterFormState;
      if (typeof navState.amountCents !== 'number') {
        this.state.set('invalidUrl');
        return;
      }
      try {
        row = await this.depositService.initiateDeposit({
          depositId,
          amountCents: navState.amountCents,
          currency: navState.currency ?? 'USD',
        });
      } catch (mutErr) {
        this.failureReason.set(mutErr instanceof Error ? mutErr.message : 'Deposit failed');
        this.state.set('failed');
        return;
      }
    }

    this.hydrate(row);
    if (this.state() === 'initiated') this.armTimeout();
  }

  private hydrate(row: Deposit): void {
    this.deposit.set(row);
    if (row.status === 'DETECTED') { this.state.set('detected'); return; }
    if (row.status === 'FAILED') {
      this.failureReason.set(row.reason ?? 'Deposit failed');
      this.state.set('failed');
      return;
    }
    this.state.set('initiated');
  }

  private onEvent(event: DepositEvent): void {
    if (event.status === 'DETECTED') {
      this.deposit.update((d) => d ? { ...d, status: 'DETECTED', detectedAt: event.occurredAt } : d);
      this.clearTimeout();
      this.state.set('detected');
    } else if (event.status === 'FAILED') {
      this.failureReason.set(event.reason ?? 'Deposit failed');
      this.clearTimeout();
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

  tryAgain(): void {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  newDeposit(): void {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  viewDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.clearTimeout();
    this.depositService.unsubscribeFromDepositEvent();
  }
}
