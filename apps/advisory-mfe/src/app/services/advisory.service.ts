import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  GraphqlService,
  CachedQuery,
  GET_DECISION,
  GET_AGENT_INVOCATIONS,
  GET_COMPLIANCE_CHECKS,
  RECORD_EXPLANATION_VIEW,
  CONFIRM_DECISION,
  REJECT_DECISION,
  ON_DECISION_UPDATE,
} from '@nestfolio/appsync-client';
import { LogoutOrchestrator } from '@nestfolio/shared-state';
import type {
  Decision,
  AgentInvocation,
  ComplianceCheck,
} from '../stores/advisory.store';

@Injectable({ providedIn: 'root' })
export class AdvisoryService {
  private readonly graphql = inject(GraphqlService);

  constructor() {
    inject(LogoutOrchestrator).register(() => this.invalidateCaches());
  }

  private decisionSubscription: Subscription | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  subscribeToDecisionUpdates(
    decisionId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    this.unsubscribeFromDecisionUpdates();
    this.reconnectAttempts = 0;
    this.doSubscribe(decisionId, onUpdate);
  }

  private doSubscribe(
    decisionId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    const obs = this.graphql.subscribe<{ onDecisionUpdate: Decision }>(ON_DECISION_UPDATE);
    this.decisionSubscription = obs.subscribe({
      next: (data) => {
        if (data.onDecisionUpdate && data.onDecisionUpdate.decisionId === decisionId) {
          this.reconnectAttempts = 0;
          this.invalidateCaches();
          onUpdate(data.onDecisionUpdate);
        }
      },
      error: (err) => {
        console.error('Decision subscription error', err);
        if (this.reconnectAttempts < AdvisoryService.MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 30_000);
          this.reconnectTimeout = setTimeout(() => this.doSubscribe(decisionId, onUpdate), delay);
        }
      },
    });
  }

  unsubscribeFromDecisionUpdates(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
    if (this.decisionSubscription) {
      this.decisionSubscription.unsubscribe();
      this.decisionSubscription = null;
    }
  }

  private decisionCache: CachedQuery<{ getDecision: Decision | null }> | null = null;
  private invocationsCache: CachedQuery<{ getAgentInvocations: AgentInvocation[] | null }> | null = null;
  private complianceCache: CachedQuery<{ getComplianceChecks: ComplianceCheck[] | null }> | null = null;

  async getDecision(decisionId: string, forceRefresh = false): Promise<Decision> {
    this.ensureCaches(decisionId);
    const data = await this.decisionCache!.get(forceRefresh);
    if (!data.getDecision) throw new Error('Decision not found');
    return data.getDecision;
  }

  async getAgentInvocations(decisionId: string, forceRefresh = false): Promise<AgentInvocation[]> {
    this.ensureCaches(decisionId);
    const data = await this.invocationsCache!.get(forceRefresh);
    return data.getAgentInvocations ?? [];
  }

  async getComplianceChecks(decisionId: string, forceRefresh = false): Promise<ComplianceCheck[]> {
    this.ensureCaches(decisionId);
    const data = await this.complianceCache!.get(forceRefresh);
    return data.getComplianceChecks ?? [];
  }

  async recordExplanationView(decisionId: string): Promise<void> {
    await this.graphql.mutate(RECORD_EXPLANATION_VIEW, { decisionId });
  }

  async confirmDecision(decisionId: string): Promise<Decision> {
    const data = await this.graphql.mutate<{ confirmDecision: Decision }>(
      CONFIRM_DECISION, { decisionId },
    );
    this.invalidateCaches();
    return data.confirmDecision;
  }

  async rejectDecision(decisionId: string, reason: string): Promise<Decision> {
    const data = await this.graphql.mutate<{ rejectDecision: Decision }>(
      REJECT_DECISION, { decisionId, reason },
    );
    this.invalidateCaches();
    return data.rejectDecision;
  }

  invalidateCaches(): void {
    this.decisionCache = null;
    this.invocationsCache = null;
    this.complianceCache = null;
    this.currentDecisionId = null;
  }

  private currentDecisionId: string | null = null;

  private ensureCaches(decisionId: string): void {
    if (this.currentDecisionId !== decisionId) {
      this.currentDecisionId = decisionId;
      this.decisionCache = new CachedQuery(
        () => this.graphql.query<{ getDecision: Decision | null }>(GET_DECISION, { decisionId }),
        60_000,
      );
      this.invocationsCache = new CachedQuery(
        () => this.graphql.query<{ getAgentInvocations: AgentInvocation[] | null }>(GET_AGENT_INVOCATIONS, { decisionId }),
        60_000,
      );
      this.complianceCache = new CachedQuery(
        () => this.graphql.query<{ getComplianceChecks: ComplianceCheck[] | null }>(GET_COMPLIANCE_CHECKS, { decisionId }),
        60_000,
      );
    }
  }
}
