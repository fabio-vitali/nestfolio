import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthStore } from '../stores/auth.store';
import { authSignOut } from '../auth/auth.service';

@Component({
  selector: 'nf-logout-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      class="nf-logout-btn"
      type="button"
      data-testid="cta-logout"
      aria-label="Log out"
      (click)="logout()"
    >
      <i class="pi pi-sign-out" aria-hidden="true"></i>
      <span class="nf-logout-label">Log out</span>
    </button>
  `,
  styles: [`
    .nf-logout-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: transparent;
      border: 1px solid var(--p-surface-300);
      border-radius: 4px;
      padding: 0.35rem 0.75rem;
      cursor: pointer;
      color: var(--p-text-color);
      font-size: 0.875rem;
    }
    .nf-logout-btn:hover {
      background: var(--p-surface-100);
    }
    .nf-logout-label {
      display: none;
    }
    @media (min-width: 768px) {
      .nf-logout-label {
        display: inline;
      }
    }
  `],
})
export class LogoutButtonComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  async logout(): Promise<void> {
    try {
      await authSignOut();
    } catch {
      // Fail-safe: still clear local state + navigate even if Amplify rejects.
    } finally {
      this.authStore.logout();
      await this.router.navigate(['/login']);
    }
  }
}
