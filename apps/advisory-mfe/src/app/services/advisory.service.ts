import { Injectable, inject } from '@angular/core';
import {
  GraphqlService,
  CachedQuery,
  GET_DECISION,
  GET_AGENT_INVOCATIONS,
  GET_COMPLIANCE_CHECKS,
  RECORD_EXPLANATION_VIEW,
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
