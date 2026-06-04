import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
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
    } @else if (realDecisions().length > 0) {
      <div class="decision-list" data-testid="advisory-decision-list">
        <h2 class="list-title">{{ i18n.t('advisory.list.title') }}</h2>
        @if (generating()) {
          <div class="generating-banner" data-testid="advisory-generating-banner">
            <span class="pi pi-spin pi-spinner"></span>
            {{ i18n.t('advisory.list.generatingTitle') }}
          </div>
        }
        <ul class="items">
          @for (d of realDecisions(); track d.decisionId) {
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
    } @else if (generating()) {
      <div data-testid="advisory-generating-state">
        <nf-empty-state
          icon="pi pi-spin pi-spinner"
          [title]="i18n.t('advisory.list.generatingTitle')"
          [message]="i18n.t('advisory.list.generatingHint')"
        />
      </div>
    } @else if (failed()) {
      <div data-testid="advisory-failed-state">
        <nf-empty-state
          icon="pi pi-exclamation-triangle"
          [title]="i18n.t('advisory.list.failedTitle')"
          [message]="i18n.t('advisory.list.failedHint')"
        />
      </div>
    } @else {
      <nf-empty-state
        icon="pi pi-chart-line"
        [title]="i18n.t('advisory.list.emptyTitle')"
        [message]="i18n.t('advisory.list.emptyHint')"
      />
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
      .generating-banner {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        margin-bottom: 0.5rem;
        background: var(--p-surface-50);
        border: 1px dashed var(--p-primary-300);
        border-radius: 0.375rem;
        font-size: 0.875rem;
        color: var(--p-surface-700);
      }
      .generating-banner .pi-spinner {
        color: var(--p-primary-500);
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

  // Drives the staleness guard. Ticked by an interval in ngOnInit so the
  // computed signals below re-evaluate over time; settable directly in tests.
  readonly now = signal<number>(Date.now());
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  // A GENERATING row older than this (with no STARTED→PENDING/FAILED transition)
  // renders as failed. Derived from AGENT_BUDGETS (PORTFOLIO_ENGINE 120s +
  // ADVISORY_NARRATIVE 120s = 240s sequential) + ~2 min margin for
  // ParallelProjections + AssemblePacket + EB→SQS→CDC propagation + clock skew.
  // Covers uncatchable States.Runtime failures that emit no DECISION_CYCLE_FAILED.
  static readonly STALE_CYCLE_MS = 6 * 60 * 1000;
  private static readonly TICK_MS = 30 * 1000;

  private isStaleGenerating(d: PendingDecisionListItem): boolean {
    if (d.status !== 'GENERATING') return false;
    const ageMs = this.now() - new Date(d.createdAt).getTime();
    return ageMs >= DecisionListComponent.STALE_CYCLE_MS;
  }

  /** Rows that represent an actual decision — everything that is not a
   *  cycle-lifecycle placeholder. These are the only rows shown in the list. */
  readonly realDecisions = computed(() =>
    this.decisions().filter((d) => d.status !== 'GENERATING' && d.status !== 'FAILED'),
  );

  /** True when a cycle is actively generating (a fresh, non-stale GENERATING row). */
  readonly generating = computed(() =>
    this.decisions().some((d) => d.status === 'GENERATING' && !this.isStaleGenerating(d)),
  );

  /** True when the latest signal is a failure and nothing is in flight / ready:
   *  a FAILED row, or a GENERATING row that has gone stale (uncatchable failure). */
  readonly failed = computed(() => {
    if (this.realDecisions().length > 0 || this.generating()) return false;
    return this.decisions().some(
      (d) => d.status === 'FAILED' || (d.status === 'GENERATING' && this.isStaleGenerating(d)),
    );
  });

  // Mirrors services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js
  // — keep in sync if backend filter changes. GENERATING/FAILED included so the
  // cycle-lifecycle rows reach decisions() and drive the spinner/error UI.
  private static readonly PENDING_STATUSES = new Set<string>([
    'PENDING',
    'DRAFT',
    'PROPOSED',
    'COMPLIANCE_REVIEW',
    'APPROVED',
    'CONFIRMATION_REQUIRED',
    'AWAITING_CONFIRMATION',
    'GENERATING',
    'FAILED',
  ]);

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.tickHandle = setInterval(
      () => this.now.set(Date.now()),
      DecisionListComponent.TICK_MS,
    );

    const tenantId = this.authStore.user()?.tenantId;
    if (tenantId) {
      // Pattern B (R1): subscription BEFORE the query fires so frames delivered
      // during query resolution are not lost.
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
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
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
