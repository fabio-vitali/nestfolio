import { Injectable } from '@angular/core';
import {
  query,
  mutate,
  GET_DECISION,
  GET_AGENT_INVOCATIONS,
  GET_COMPLIANCE_CHECKS,
  RECORD_EXPLANATION_VIEW,
} from '@nestfolio/appsync-client';
import type {
  Decision,
  AgentInvocation,
  ComplianceCheck,
} from '../stores/advisory.store';

@Injectable({ providedIn: 'root' })
export class AdvisoryService {
  async getDecision(decisionId: string): Promise<Decision> {
    const data = await query<{ getDecision: Decision }>(GET_DECISION, { decisionId });
    return data.getDecision;
  }

  async getAgentInvocations(decisionId: string): Promise<AgentInvocation[]> {
    const data = await query<{ getAgentInvocations: AgentInvocation[] }>(
      GET_AGENT_INVOCATIONS,
      { decisionId },
    );
    return data.getAgentInvocations;
  }

  async getComplianceChecks(decisionId: string): Promise<ComplianceCheck[]> {
    const data = await query<{ getComplianceChecks: ComplianceCheck[] }>(
      GET_COMPLIANCE_CHECKS,
      { decisionId },
    );
    return data.getComplianceChecks;
  }

  async recordExplanationView(decisionId: string): Promise<void> {
    await mutate(RECORD_EXPLANATION_VIEW, { decisionId });
  }
}
