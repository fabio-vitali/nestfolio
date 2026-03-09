import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { authSignUp } from '@nestfolio/auth';
import { I18nService } from '@nestfolio/i18n';
import { AuthStore } from '@nestfolio/shared-state';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule, PasswordModule, ButtonModule, MessageModule, CardModule, InputNumberModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-container">
      <p-card>
        <ng-template pTemplate="header">
          <div class="auth-header">
            <h1>Nestfolio</h1>
            <p>{{ i18n.t('auth.createAccount') }}</p>
          </div>
        </ng-template>

        @if (error()) {
          <p-message severity="error" [text]="error()!" />
        }

        <div class="auth-form">
          <div class="field">
            <label for="name">{{ i18n.t('auth.name') }}</label>
            <input pInputText id="name" [(ngModel)]="name" placeholder="Full name" class="w-full" />
          </div>

          <div class="field">
            <label for="email">{{ i18n.t('auth.email') }}</label>
            <input pInputText id="email" type="email" [(ngModel)]="email" [placeholder]="i18n.t('auth.email')" class="w-full" />
          </div>

          <div class="field">
            <label for="age">{{ i18n.t('auth.age') }}</label>
            <p-inputNumber id="age" [(ngModel)]="age" [min]="18" [max]="120" class="w-full" />
          </div>

          <div class="field">
            <label for="password">{{ i18n.t('auth.password') }}</label>
            <p-password id="password" [(ngModel)]="password" [toggleMask]="true" styleClass="w-full" inputStyleClass="w-full" />
          </div>

          <p-button
            [label]="i18n.t('auth.signup')"
            (click)="onSignup()"
            [loading]="loading()"
            styleClass="w-full"
          />

          <div class="auth-footer">
            <a routerLink="/login">{{ i18n.t('auth.login') }}</a>
          </div>
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
    .auth-footer { text-align: center; margin-top: 0.5rem; }
    .auth-footer a { color: var(--p-primary-500); text-decoration: none; font-size: 0.875rem; }
  `],
})
export class SignupComponent {
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  readonly i18n = inject(I18nService);

  name = '';
  email = '';
  password = '';
  age: number | null = null;
  loading = signal(false);
  error = signal<string | null>(null);

  async onSignup() {
    if (!this.name || !this.email || !this.password || !this.age) {
      this.error.set('Please fill all fields');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await authSignUp({
        username: this.email,
        password: this.password,
        email: this.email,
        name: this.name,
        age: String(this.age),
      });

      if (result.isSignUpComplete) {
        await this.router.navigate(['/login']);
      } else {
        this.authStore.setPendingEmail(this.email);
        await this.router.navigate(['/confirm']);
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      this.loading.set(false);
    }
  }
}
