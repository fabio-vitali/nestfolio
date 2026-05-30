import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SharedModule } from 'primeng/api';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import {
  ExpandableComponent,
  AgentBadgeComponent,
  StatusBadgeComponent,
  LoadingSkeletonComponent,
} from '@nestfolio/ui';
import { I18nService } from '@nestfolio/shell/i18n';
import { AuthStore, parseError } from '@nestfolio/shell';
import { AdvisoryStore } from '../stores/advisory.store';
import { AdvisoryService } from '../services/advisory.service';
import { AuditFooterComponent } from './audit-footer.component';
import { TradesTableComponent } from './trades-table.component';

@Component({
  selector: 'app-decision-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    SharedModule,
    MessageModule,
    ButtonModule,
    DialogModule,
    ExpandableComponent,
    AgentBadgeComponent,
    StatusBadgeComponent,
    LoadingSkeletonComponent,
    AuditFooterComponent,
    TradesTableComponent,
  ],
  template: `
    @if (store.loading() && !store.isLoaded()) {
      <nf-loading-skeleton [count]="10" />
    } @else {
      <div class="decision-detail">
        @if (store.successMessage()) {
          <p-message severity="success" [text]="store.successMessage()" styleClass="w-full" />
        }

        @if (store.error()) {
          <p-message severity="error" [text]="i18n.t(store.error()!)" styleClass="w-full" />
        }

        @if (store.decision(); as decision) {
          <!-- Headline card: always visible -->
          <div class="headline-card">
            <div class="headline-top">
              <h2 class="headline-title">{{ store.headline() }}</h2>
              <div class="headline-badges">
                <nf-status-badge [label]="decision.status" [severity]="store.statusSeverity()" />
                @if (decision.proposedTrades?.some(t => t.side === 'SELL')) {
                  <span class="rebalance-badge" data-testid="rebalance-badge">{{ 'advisory.detail.rebalanceBadge' | translate }}</span>
                }
              </div>
            </div>

            <div class="agent-badges">
              @for (inv of store.agentInvocations(); track inv.invocationId) {
                <nf-agent-badge [agentName]="inv.agentName" [tier]="inv.modelId" />
              }
            </div>

            @if (decision.explanation) {
              <p class="rationale">{{ decision.explanation }}</p>
            }
          </div>

          <!-- Action Buttons -->
          @if (store.canAct()) {
            <div class="action-buttons">
              <p-button
                [label]="'advisory.detail.confirm' | translate"
                severity="success"
                [loading]="actionType === 'confirm' && store.loading()"
                [disabled]="!store.canAct()"
                (onClick)="onConfirm()"
              />
              <p-button
                [label]="'advisory.detail.reject' | translate"
                severity="danger"
                [loading]="actionType === 'reject' && store.loading()"
                [disabled]="!store.canAct()"
                (onClick)="showRejectDialog = true"
              />
            </div>
          }

          <!-- Reject Dialog -->
          <p-dialog
            [header]="'advisory.detail.rejectTitle' | translate"
            [(visible)]="showRejectDialog"
            [modal]="true"
            [style]="{ width: '24rem' }"
          >
            <div class="reject-form">
              <textarea
                class="reject-reason"
                [(ngModel)]="rejectReason"
                [placeholder]="'advisory.detail.rejectReasonPlaceholder' | translate"
                rows="4"
              ></textarea>
            </div>
            <ng-template pTemplate="footer">
              <p-button
                [label]="'common.cancel' | translate"
                severity="secondary"
                (onClick)="showRejectDialog = false"
              />
              <p-button
                [label]="'advisory.detail.reject' | translate"
                severity="danger"
                [loading]="actionType === 'reject' && store.loading()"
                [disabled]="!rejectReason.trim()"
                (onClick)="onReject()"
              />
            </ng-template>
          </p-dialog>

          <!-- Expandable: Proposed Trades -->
          @if (decision.proposedTrades.length > 0) {
            <nf-expandable [title]="'advisory.detail.trades' | translate">
              <app-trades-table [trades]="decision.proposedTrades" />
            </nf-expandable>
          }

          <!-- Expandable: Agent Invocations -->
          @if (store.agentInvocations().length > 0) {
            <nf-expandable [title]="'advisory.detail.agentInvocations' | translate">
              <div class="invocations-list">
                @for (inv of store.agentInvocations(); track inv.invocationId) {
                  <div class="invocation-item">
                    <div class="invocation-header">
                      <nf-agent-badge [agentName]="inv.agentName" [tier]="inv.modelId" />
                      <nf-status-badge
                        [label]="inv.status"
                        [severity]="inv.status === 'COMPLETED' ? 'success' : inv.status === 'FAILED' ? 'danger' : 'info'"
                      />
                    </div>
                    <div class="invocation-meta">
                      <span>{{ inv.latencyMs }}ms</span>
                      <span>{{ inv.startedAt | date:'short' }}</span>
                    </div>
                    @if (inv.errorMessage) {
                      <p class="invocation-output">{{ inv.errorMessage }}</p>
                    }
                  </div>
                }
              </div>
            </nf-expandable>
          }

          <!-- Expandable: Compliance Checks -->
          @if (store.complianceChecks().length > 0) {
            <nf-expandable [title]="'advisory.detail.compliance' | translate">
              <div class="compliance-summary">
                <nf-status-badge
                  [label]="store.compliancePassed() ? 'PASS' : 'FAIL'"
                  [severity]="store.compliancePassed() ? 'success' : 'danger'"
                />
              </div>
              <div class="compliance-list">
                @for (check of store.complianceChecks(); track check.checkId) {
                  <div class="compliance-item">
                    <div class="compliance-rule">
                      <span class="rule-name">{{ check.ruleName }}</span>
                      <nf-status-badge
                        [label]="check.result"
                        [severity]="check.result === 'PASSED' ? 'success' : check.result === 'FAILED' ? 'danger' : 'warn'"
                      />
                    </div>
                    @if (check.details) {
                      <p class="compliance-details">{{ check.details }}</p>
                    }
                  </div>
                }
              </div>
            </nf-expandable>
          }

          <!-- Audit Footer -->
          <app-audit-footer
            [decisionId]="decision.decisionId"
            [modelVersions]="store.modelVersions()"
            [createdAt]="decision.createdAt"
            [version]="decision.version"
          />
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    .decision-detail {
      padding: 0.75rem;
      max-width: 48rem;
      margin: 0 auto;
    }

    .headline-card {
      background: var(--p-surface-0);
      border: 1px solid var(--p-surface-200);
      border-radius: 0.75rem;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .headline-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .headline-badges {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      flex-shrink: 0;
    }

    .rebalance-badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      background: var(--p-orange-100);
      color: var(--p-orange-700);
    }

    .headline-title {
      font-size: 1.125rem;
      font-weight: 700;
      margin: 0;
      color: var(--p-surface-900);
    }

    .agent-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      margin-bottom: 0.5rem;
    }

    .rationale {
      font-size: 0.875rem;
      color: var(--p-surface-600);
      margin: 0;
      line-height: 1.5;
    }

    .invocations-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .invocation-item {
      padding: 0.5rem;
      border: 1px solid var(--p-surface-100);
      border-radius: 0.375rem;
    }

    .invocation-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .invocation-meta {
      display: flex;
      gap: 1rem;
      font-size: 0.75rem;
      color: var(--p-surface-500);
    }

    .invocation-output {
      font-size: 0.8125rem;
      color: var(--p-surface-600);
      margin: 0.25rem 0 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .compliance-summary {
      margin-bottom: 0.5rem;
    }

    .compliance-list {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .compliance-item {
      padding: 0.375rem 0;
      border-bottom: 1px solid var(--p-surface-100);
    }

    .compliance-item:last-child { border-bottom: none; }

    .compliance-rule {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .rule-name {
      font-size: 0.8125rem;
      font-weight: 500;
    }

    .compliance-details {
      font-size: 0.75rem;
      color: var(--p-surface-500);
      margin: 0.125rem 0 0;
    }

    .action-buttons {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .reject-form {
      padding: 0.5rem 0;
    }

    .reject-reason {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--p-surface-200);
      border-radius: 0.375rem;
      font-family: inherit;
      font-size: 0.875rem;
      resize: vertical;
    }

    .w-full { width: 100%; }
  `],
})
export class DecisionDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly advisoryService = inject(AdvisoryService);
  private readonly translate = inject(TranslateService);
  private readonly authStore = inject(AuthStore);
  readonly i18n = inject(I18nService);
  readonly store = inject(AdvisoryStore);

  actionType: 'confirm' | 'reject' | null = null;
  showRejectDialog = false;
  rejectReason = '';

  async ngOnInit(): Promise<void> {
    const decisionId = this.route.snapshot.paramMap.get('id');
    if (!decisionId) {
      this.store.setError('Missing decision ID');
      return;
    }
    await this.loadDecision(decisionId);
  }

  ngOnDestroy(): void {
    this.advisoryService.unsubscribeFromDecisionUpdates();
    this.store.reset();
  }

  private async loadDecision(decisionId: string): Promise<void> {
    this.store.setLoading(true);
    this.store.setError(null);

    const tenantId = this.authStore.user()?.tenantId;
    if (!tenantId) {
      this.store.setError('errors.missingTenant');
      this.store.setLoading(false);
      return;
    }

    // R1: attach subscription BEFORE the queries fire. Frames that arrive
    // during query resolution are version-guarded into the store; the
    // setDecision() call from the resolved query is also version-guarded so
    // an older query result does not clobber a newer broadcast already in.
    this.advisoryService.subscribeToDecisionUpdates(tenantId, decisionId, (updated) => {
      const current = this.store.decision();
      if (!current || updated.version >= current.version) {
        this.store.setDecision(updated);
      }
    });

    try {
      const [decision, invocations, checks] = await Promise.all([
        this.advisoryService.getDecision(decisionId),
        this.advisoryService.getAgentInvocations(decisionId),
        this.advisoryService.getComplianceChecks(decisionId),
      ]);

      const current = this.store.decision();
      if (!current || decision.version >= current.version) {
        this.store.setDecision(decision);
      }
      this.store.setAgentInvocations(invocations);
      this.store.setComplianceChecks(checks);

      this.advisoryService.recordExplanationView(decisionId).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('audit log failed', err);
      });
    } catch (e: unknown) {
      this.store.setError(parseError(e, 'errors.decision'));
    } finally {
      this.store.setLoading(false);
    }
  }

  async onConfirm(): Promise<void> {
    const current = this.store.decision();
    if (!current) return;

    this.actionType = 'confirm';
    this.store.setLoading(true);
    // Optimistic: flip the badge now; the authoritative CONFIRMED arrives via the
    // onDecisionUpdate projection frame (version > current.version, so it lands).
    // Keep current.version so the optimistic write never blocks the real frame.
    this.store.setDecision({ ...current, status: 'CONFIRMED' });
    try {
      await this.advisoryService.confirmDecision(current.decisionId);
      this.store.setSuccess(this.translate.instant('advisory.detail.confirmSuccess'));
    } catch (e: unknown) {
      this.store.setDecision(current); // revert optimistic update
      this.store.setError(parseError(e, 'errors.decision'));
    } finally {
      this.store.setLoading(false);
      this.actionType = null;
    }
  }

  async onReject(): Promise<void> {
    const current = this.store.decision();
    if (!current) return;

    this.actionType = 'reject';
    this.store.setLoading(true);
    this.store.setDecision({ ...current, status: 'REJECTED' });
    try {
      await this.advisoryService.rejectDecision(current.decisionId, this.rejectReason.trim());
      this.showRejectDialog = false;
      this.rejectReason = '';
      this.store.setSuccess(this.translate.instant('advisory.detail.rejectSuccess'));
    } catch (e: unknown) {
      this.store.setDecision(current); // revert
      this.store.setError(parseError(e, 'errors.decision'));
    } finally {
      this.store.setLoading(false);
      this.actionType = null;
    }
  }

  navigateBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
