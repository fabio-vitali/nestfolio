import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MessageModule } from 'primeng/message';
import {
  ExpandableComponent,
  AgentBadgeComponent,
  StatusBadgeComponent,
  LoadingSkeletonComponent,
} from '@nestfolio/ui-components';
import { I18nService } from '@nestfolio/i18n';
import { parseError } from '@nestfolio/shared-state';
import { AdvisoryStore } from '../stores/advisory.store';
import { AdvisoryService } from '../services/advisory.service';
import { AuditFooterComponent } from './audit-footer.component';
import { TradesTableComponent } from './trades-table.component';

@Component({
  selector: 'app-decision-detail',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MessageModule,
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
        @if (store.error()) {
          <p-message severity="error" [text]="store.error()!" styleClass="w-full" />
        }

        @if (store.decision(); as decision) {
          <!-- Headline card: always visible -->
          <div class="headline-card">
            <div class="headline-top">
              <h2 class="headline-title">{{ store.headline() }}</h2>
              <nf-status-badge [label]="decision.status" [severity]="store.statusSeverity()" />
            </div>

            <div class="agent-badges">
              @for (inv of store.agentInvocations(); track inv.invocationId) {
                <nf-agent-badge [agentName]="inv.agentName" [tier]="inv.tier" />
              }
            </div>

            @if (decision.rationale) {
              <p class="rationale">{{ decision.rationale }}</p>
            }
          </div>

          <!-- Expandable: Proposed Trades -->
          @if (decision.proposedActions.length > 0) {
            <nf-expandable [title]="'advisory.detail.trades' | translate">
              <app-trades-table [trades]="decision.proposedActions" />
            </nf-expandable>
          }

          <!-- Expandable: Agent Invocations -->
          @if (store.agentInvocations().length > 0) {
            <nf-expandable [title]="'advisory.detail.agentInvocations' | translate">
              <div class="invocations-list">
                @for (inv of store.agentInvocations(); track inv.invocationId) {
                  <div class="invocation-item">
                    <div class="invocation-header">
                      <nf-agent-badge [agentName]="inv.agentName" [tier]="inv.tier" />
                      <nf-status-badge
                        [label]="inv.status"
                        [severity]="inv.status === 'COMPLETED' ? 'success' : inv.status === 'FAILED' ? 'danger' : 'info'"
                      />
                    </div>
                    <div class="invocation-meta">
                      <span>{{ inv.durationMs }}ms</span>
                      <span>{{ inv.invokedAt | date:'short' }}</span>
                    </div>
                    @if (inv.output) {
                      <p class="invocation-output">{{ inv.output }}</p>
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

    .w-full { width: 100%; }
  `],
})
export class DecisionDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly advisoryService = inject(AdvisoryService);
  readonly i18n = inject(I18nService);
  readonly store = inject(AdvisoryStore);

  private static readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async ngOnInit(): Promise<void> {
    const decisionId = this.route.snapshot.paramMap.get('id');
    if (!decisionId) {
      this.store.setError('Missing decision ID');
      return;
    }
    if (!DecisionDetailComponent.UUID_REGEX.test(decisionId)) {
      this.router.navigate(['/dashboard']);
      return;
    }
    await this.loadDecision(decisionId);
  }

  ngOnDestroy(): void {
    this.store.reset();
  }

  private async loadDecision(decisionId: string): Promise<void> {
    this.store.setLoading(true);
    this.store.setError(null);

    try {
      const [decision, invocations, checks] = await Promise.all([
        this.advisoryService.getDecision(decisionId),
        this.advisoryService.getAgentInvocations(decisionId),
        this.advisoryService.getComplianceChecks(decisionId),
      ]);

      this.store.setDecision(decision);
      this.store.setAgentInvocations(invocations);
      this.store.setComplianceChecks(checks);

      // Record that user viewed the explanation (fire-and-forget, but log errors)
      this.advisoryService.recordExplanationView(decisionId).catch((err) => {
        console.error('audit log failed', err);
      });
    } catch (e: unknown) {
      this.store.setError(parseError(e, 'errors.decision'));
    } finally {
      this.store.setLoading(false);
    }
  }

  navigateBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
