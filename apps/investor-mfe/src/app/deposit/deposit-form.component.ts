import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';

const FEATURE_FLAG = 'initiateDeposit';

@Component({
  selector: 'app-deposit-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, InputNumberModule, MessageModule],
  template: `
    <div class="deposit-page">
      <h1 class="page-title">Fund account</h1>
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
            [max]="10000000" />
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
            (onClick)="cancel()" />
          <p-button
            label="Confirm"
            data-testid="deposit-confirm"
            [disabled]="confirmDisabled()"
            (onClick)="submit()" />
        </div>
      </p-card>
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
    .w-full { width: 100%; }
  `],
})
export class DepositFormComponent {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly flagsStore = inject(FeatureFlagsStore);

  readonly amount = signal<number | null>(null);

  readonly flagEnabled = computed(() => this.flagsStore.isEnabled(FEATURE_FLAG));
  readonly flagReason = computed(() => this.flagsStore.flags()[FEATURE_FLAG]?.reason ?? null);

  readonly confirmDisabled = computed(() => {
    const a = this.amount();
    if (a == null || a <= 0) return true;
    if (!this.flagEnabled()) return true;
    return false;
  });

  submit(): void {
    if (this.confirmDisabled()) return;
    const depositId = crypto.randomUUID();
    const amountCents = Math.round((this.amount() ?? 0) * 100);
    this.router.navigate([depositId], {
      relativeTo: this.route,
      state: { amountCents, currency: 'USD' },
    });
  }

  cancel(): void {
    this.router.navigate(['/dashboard']);
  }
}
