import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { CardModule } from 'primeng/card';
import { authSignIn } from '@nestfolio/auth';
import { I18nService } from '@nestfolio/i18n';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule, PasswordModule, ButtonModule, MessageModule, CardModule, RouterLink],
  template: `
    <div class="auth-container">
      <p-card>
        <ng-template pTemplate="header">
          <div class="auth-header">
            <h1>Nestfolio</h1>
            <p>{{ i18n.t('auth.welcomeBack') }}</p>
          </div>
        </ng-template>

        @if (error()) {
          <p-message severity="error" [text]="error()!" />
        }

        <div class="auth-form">
          <div class="field">
            <label for="email">{{ i18n.t('auth.email') }}</label>
            <input
              pInputText
              id="email"
              type="email"
              [(ngModel)]="email"
              [placeholder]="i18n.t('auth.email')"
              class="w-full"
            />
          </div>

          <div class="field">
            <label for="password">{{ i18n.t('auth.password') }}</label>
            <p-password
              id="password"
              [(ngModel)]="password"
              [toggleMask]="true"
              [feedback]="false"
              styleClass="w-full"
              inputStyleClass="w-full"
            />
          </div>

          <p-button
            [label]="i18n.t('auth.login')"
            (click)="onLogin()"
            [loading]="loading()"
            styleClass="w-full"
          />

          <div class="auth-footer">
            <a routerLink="/signup">{{ i18n.t('auth.createAccount') }}</a>
          </div>
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .auth-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1rem;
      background: var(--nf-bg-secondary);
    }
    :host ::ng-deep .p-card { width: 100%; max-width: 400px; }
    .auth-header { text-align: center; padding: 1.5rem 1rem 0; }
    .auth-header h1 { font-size: 1.75rem; margin: 0; color: var(--p-primary-500); }
    .auth-header p { margin: 0.5rem 0 0; color: var(--nf-text-secondary); }
    .auth-form { display: flex; flex-direction: column; gap: 1rem; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; }
    .field label { font-size: 0.875rem; font-weight: 500; }
    .w-full { width: 100%; }
    .auth-footer { text-align: center; margin-top: 0.5rem; }
    .auth-footer a { color: var(--p-primary-500); text-decoration: none; font-size: 0.875rem; }
  `],
})
export class LoginComponent {
  private router = inject(Router);
  readonly i18n = inject(I18nService);

  email = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  async onLogin() {
    if (!this.email || !this.password) {
      this.error.set('Please enter email and password');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await authSignIn(this.email, this.password);
      if (result.isSignedIn) {
        await this.router.navigate(['/dashboard']);
      } else if (result.nextStep === 'CONFIRM_SIGN_UP') {
        await this.router.navigate(['/confirm'], { state: { email: this.email } });
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Login failed');
    } finally {
      this.loading.set(false);
    }
  }
}
