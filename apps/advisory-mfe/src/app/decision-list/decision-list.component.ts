import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  EmptyStateComponent,
  LoadingSkeletonComponent,
  StatusBadgeComponent,
} from '@nestfolio/ui';
import { I18nService } from '@nestfolio/shell/i18n';
import { AuthStore, parseError } from '@nestfolio/shell';
import {
  AdvisoryService,
  type PendingDecisionListItem,
} from '../services/advisory.service';
import type { Decision } from '../stores/advisory.store';

@Component({
  selector: 'app-decision-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    EmptyStateComponent,
    LoadingSkeletonComponent,
    StatusBadgeComponent,
  ],
  template: `
    @if (loading() && !loaded()) {
      <nf-loading-skeleton [count]="5" />
    } @else if (error()) {
      <nf-empty-state
        icon="pi pi-exclamation-triangle"
        [title]="i18n.t('advisory.list.errorTitle')"
        [message]="i18n.t(error()!)"
      />
    } @else if (decisions().length === 0) {
      <nf-empty-state
        icon="pi pi-chart-line"
        [title]="i18n.t('advisory.list.emptyTitle')"
        [message]="i18n.t('advisory.list.emptyHint')"
      />
    } @else {
      <div class="decision-list" data-testid="advisory-decision-list">
        <h2 class="list-title">{{ i18n.t('advisory.list.title') }}</h2>
        <ul class="items">
          @for (d of decisions(); track d.decisionId) {
            <li class="item">
              <a
                class="item-link"
                [routerLink]="['/advisory', d.decisionId]"
                [attr.data-testid]="'decision-' + d.decisionId"
              >
                <div class="item-row">
                  <span class="item-trigger">{{ d.trigger }}</span>
                  <nf-status-badge
                    [label]="d.status"
                    [severity]="statusSeverity(d.status)"
                  />
                </div>
                <span class="item-date">{{ d.createdAt | date: 'short' }}</span>
              </a>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .decision-list {
        padding: 0.75rem;
        max-width: 48rem;
        margin: 0 auto;
      }
      .list-title {
        font-size: 1.125rem;
        font-weight: 700;
        margin: 0 0 0.75rem;
        color: var(--p-surface-900);
      }
      .items {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .item-link {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.75rem 1rem;
        background: var(--p-surface-0);
        border: 1px solid var(--p-surface-200);
        border-radius: 0.5rem;
        text-decoration: none;
        color: inherit;
        transition: border-color 120ms ease;
      }
      .item-link:hover {
        border-color: var(--p-primary-300);
      }
      .item-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }
      .item-trigger {
        font-size: 0.9375rem;
        font-weight: 600;
      }
      .item-date {
        font-size: 0.75rem;
        color: var(--p-surface-500);
      }
    `,
  ],
})
export class DecisionListComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly advisoryService = inject(AdvisoryService);
  private readonly authStore = inject(AuthStore);

  readonly decisions = signal<PendingDecisionListItem[]>([]);
  readonly loading = signal<boolean>(false);
  readonly loaded = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Mirrors services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js
  // — keep in sync if backend filter changes.
  private static readonly PENDING_STATUSES = new Set<string>([
    'PENDING',
    'DRAFT',
    'PROPOSED',
    'COMPLIANCE_REVIEW',
    'APPROVED',
    'CONFIRMATION_REQUIRED',
    'AWAITING_CONFIRMATION',
  ]);

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const tenantId = this.authStore.user()?.tenantId;
    if (tenantId) {
      // Pattern B (R1): attach subscription BEFORE the query fires so any frame
      // that arrives during query resolution is reconciled, not lost.
      this.advisoryService.subscribeToDecisionListUpdates(tenantId, (frame) =>
        this.reconcile(frame),
      );
    }

    try {
      const items = await this.advisoryService.getPendingDecisions();
      this.decisions.set(items);
      this.loaded.set(true);
    } catch (e: unknown) {
      this.error.set(parseError(e, 'errors.decision'));
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.advisoryService.unsubscribeFromDecisionListUpdates();
  }

  private reconcile(frame: Decision): void {
    const current = this.decisions();
    const idx = current.findIndex((d) => d.decisionId === frame.decisionId);
    const isPending = DecisionListComponent.PENDING_STATUSES.has(frame.status);

    if (idx === -1) {
      if (isPending) {
        this.decisions.set([
          {
            decisionId: frame.decisionId,
            status: frame.status,
            trigger: frame.trigger,
            createdAt: frame.createdAt,
          },
          ...current,
        ]);
      }
      return;
    }

    if (!isPending) {
      this.decisions.set(current.filter((_, i) => i !== idx));
      return;
    }

    const next = [...current];
    next[idx] = {
      ...current[idx],
      status: frame.status,
      trigger: frame.trigger,
    };
    this.decisions.set(next);
  }

  statusSeverity(
    status: string,
  ): 'success' | 'danger' | 'info' | 'warn' | 'secondary' {
    switch (status) {
      case 'APPROVED':
      case 'CONFIRMED':
      case 'FILLED':
        return 'success';
      case 'BLOCKED':
      case 'FAILED':
      case 'REJECTED':
        return 'danger';
      case 'PROPOSED':
      case 'COMPLIANCE_REVIEW':
      case 'EXECUTING':
        return 'info';
      case 'CONFIRMATION_REQUIRED':
      case 'AWAITING_CONFIRMATION':
        return 'warn';
      default:
        return 'secondary';
    }
  }
}
