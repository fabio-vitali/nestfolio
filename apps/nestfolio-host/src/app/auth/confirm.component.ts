import { Component, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { CardModule } from 'primeng/card';
import { authConfirmSignUp } from '@nestfolio/auth';
import { I18nService } from '@nestfolio/i18n';
import { AuthStore } from '@nestfolio/shared-state';

@Component({
  selector: 'app-confirm',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule, ButtonModule, MessageModule, CardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-container">
      <p-card>
        <ng-template pTemplate="header">
          <div class="auth-header">
            <h1>Nestfolio</h1>
            <p>{{ i18n.t('auth.confirmCode') }}</p>
          </div>
        </ng-template>

        @if (error()) {
          <p-message severity="error" [text]="error()!" />
        }

        @if (success()) {
          <p-message severity="success" text="Account confirmed! Redirecting to login..." />
        }

        <div class="auth-form">
          <div class="field">
            <label for="email">{{ i18n.t('auth.email') }}</label>
            <input pInputText id="email" [(ngModel)]="email" [disabled]="!!emailFromStore" class="w-full" />
          </div>

          <div class="field">
            <label for="code">{{ i18n.t('auth.confirmCode') }}</label>
            <input pInputText id="code" [(ngModel)]="code" placeholder="123456" class="w-full" />
          </div>

          <p-button
            [label]="i18n.t('common.confirm')"
            (click)="onConfirm()"
            [loading]="loading()"
            styleClass="w-full"
          />
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .auth-container {
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; padding: 1rem; background: var(--nf-bg-secondary);
    }
    :host ::ng-deep .p-card { width: 100%; max-width: 400px; }
    .auth-header { text-align: center; padding: 1.5rem 1rem 0; }
    .auth-header h1 { font-size: 1.75rem; margin: 0; color: var(--p-primary-500); }
    .auth-header p { margin: 0.5rem 0 0; color: var(--nf-text-secondary); }
    .auth-form { display: flex; flex-direction: column; gap: 1rem; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; }
    .field label { font-size: 0.875rem; font-weight: 500; }
    .w-full { width: 100%; }
  `],
})
export class ConfirmComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  readonly i18n = inject(I18nService);

  private redirectTimer: ReturnType<typeof setTimeout> | undefined;

  email = '';
  emailFromStore = '';
  code = '';
  loading = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  ngOnDestroy() {
    if (this.redirectTimer) {
      clearTimeout(this.redirectTimer);
    }
  }

  ngOnInit() {
    this.emailFromStore = this.authStore.pendingEmail() ?? '';
    this.email = this.emailFromStore;
  }

  async onConfirm() {
    if (!this.email || !this.code) {
      this.error.set('Please enter email and confirmation code');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await authConfirmSignUp(this.email, this.code);
      if (result.isSignUpComplete) {
        this.success.set(true);
        this.authStore.clearPendingEmail();
        this.redirectTimer = setTimeout(() => this.router.navigate(['/login']), 2000);
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Confirmation failed');
    } finally {
      this.loading.set(false);
    }
  }
}
