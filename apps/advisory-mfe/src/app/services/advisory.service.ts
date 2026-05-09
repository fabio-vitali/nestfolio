import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService, CachedQuery } from '@nestfolio/shell/graphql';
import {
  GET_DECISION,
  GET_PENDING_DECISIONS,
  GET_AGENT_INVOCATIONS,
  GET_COMPLIANCE_CHECKS,
  RECORD_EXPLANATION_VIEW,
  CONFIRM_DECISION,
  REJECT_DECISION,
  ON_DECISION_UPDATE,
  GET_ADVISORY_STATUS,
  ON_ADVISORY_STATUS_UPDATE,
} from '../graphql/advisory-bff.queries';
import { LogoutOrchestrator } from '@nestfolio/shell';
import type {
  Decision,
  AgentInvocation,
  ComplianceCheck,
} from '../stores/advisory.store';

export interface PendingDecisionListItem {
  decisionId: string;
  status: string;
  trigger: string;
  createdAt: string;
}

export interface AdvisoryStatusSnapshot {
  tenantId: string;
  inFlightCount: number;
  lastTriggerAt: string | null;
  updatedAt: string;
}

interface PendingDecisionsConnection {
  items: PendingDecisionListItem[];
  nextCursor: string | null;
}

@Injectable()
export class AdvisoryService {
  private readonly graphql = inject(GraphqlService);

  constructor() {
    inject(LogoutOrchestrator).register(() => this.invalidateCaches());
  }

  private decisionSubscription: Subscription | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  private listSubscription: Subscription | null = null;
  private listReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private listReconnectAttempts = 0;

  private statusSubscription: Subscription | null = null;
  private statusReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private statusReconnectAttempts = 0;

  subscribeToDecisionUpdates(
    tenantId: string,
    decisionId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    this.unsubscribeFromDecisionUpdates();
    this.reconnectAttempts = 0;
    this.doSubscribe(tenantId, decisionId, onUpdate);
  }

  private doSubscribe(
    tenantId: string,
    decisionId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    const obs = this.graphql.subscribe<{ onDecisionUpdate: Decision }>(ON_DECISION_UPDATE, { tenantId });
    this.decisionSubscription = obs.subscribe({
      next: (data) => {
        if (data.onDecisionUpdate && data.onDecisionUpdate.decisionId === decisionId) {
          this.reconnectAttempts = 0;
          this.invalidateCaches();
          onUpdate(data.onDecisionUpdate);
        }
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Decision subscription error', err);
        if (this.reconnectAttempts < AdvisoryService.MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 30_000);
          this.reconnectTimeout = setTimeout(() => this.doSubscribe(tenantId, decisionId, onUpdate), delay);
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

  subscribeToDecisionListUpdates(
    tenantId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    this.unsubscribeFromDecisionListUpdates();
    this.listReconnectAttempts = 0;
    this.doSubscribeToList(tenantId, onUpdate);
  }

  private doSubscribeToList(
    tenantId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    const obs = this.graphql.subscribe<{ onDecisionUpdate: Decision }>(ON_DECISION_UPDATE, { tenantId });
    this.listSubscription = obs.subscribe({
      next: (data) => {
        if (data.onDecisionUpdate) {
          this.listReconnectAttempts = 0;
          onUpdate(data.onDecisionUpdate);
        }
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Decision list subscription error', err);
        if (this.listReconnectAttempts < AdvisoryService.MAX_RECONNECT_ATTEMPTS) {
          this.listReconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, this.listReconnectAttempts - 1), 30_000);
          this.listReconnectTimeout = setTimeout(() => this.doSubscribeToList(tenantId, onUpdate), delay);
        }
      },
    });
  }

  unsubscribeFromDecisionListUpdates(): void {
    if (this.listReconnectTimeout !== null) {
      clearTimeout(this.listReconnectTimeout);
      this.listReconnectTimeout = null;
    }
    this.listReconnectAttempts = 0;
    if (this.listSubscription) {
      this.listSubscription.unsubscribe();
      this.listSubscription = null;
    }
  }

  async getAdvisoryStatus(): Promise<AdvisoryStatusSnapshot | null> {
    const data = await this.graphql.query<{ getAdvisoryStatus: AdvisoryStatusSnapshot | null }>(
      GET_ADVISORY_STATUS,
      {},
    );
    return data.getAdvisoryStatus ?? null;
  }

  subscribeToAdvisoryStatusUpdates(
    tenantId: string,
    onFrame: (snapshot: AdvisoryStatusSnapshot) => void,
  ): void {
    this.unsubscribeFromAdvisoryStatusUpdates();
    this.statusReconnectAttempts = 0;
    this.doSubscribeToStatus(tenantId, onFrame);
  }

  private doSubscribeToStatus(
    tenantId: string,
    onFrame: (snapshot: AdvisoryStatusSnapshot) => void,
  ): void {
    const obs = this.graphql.subscribe<{ onAdvisoryStatusUpdate: AdvisoryStatusSnapshot | null }>(
      ON_ADVISORY_STATUS_UPDATE,
      { tenantId },
    );
    this.statusSubscription = obs.subscribe({
      next: (data) => {
        if (data.onAdvisoryStatusUpdate) {
          this.statusReconnectAttempts = 0;
          onFrame(data.onAdvisoryStatusUpdate);
        }
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Advisory status subscription error', err);
        if (this.statusReconnectAttempts < AdvisoryService.MAX_RECONNECT_ATTEMPTS) {
          this.statusReconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, this.statusReconnectAttempts - 1), 30_000);
          this.statusReconnectTimeout = setTimeout(
            () => this.doSubscribeToStatus(tenantId, onFrame),
            delay,
          );
        }
      },
    });
  }

  unsubscribeFromAdvisoryStatusUpdates(): void {
    if (this.statusReconnectTimeout !== null) {
      clearTimeout(this.statusReconnectTimeout);
      this.statusReconnectTimeout = null;
    }
    this.statusReconnectAttempts = 0;
    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe();
      this.statusSubscription = null;
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

  async getPendingDecisions(limit = 20): Promise<PendingDecisionListItem[]> {
    const data = await this.graphql.query<{ getPendingDecisions: PendingDecisionsConnection }>(
      GET_PENDING_DECISIONS,
      { limit },
    );
    return data.getPendingDecisions?.items ?? [];
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
