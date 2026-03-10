import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  setError as callError,
  setLoading as callLoading,
  withCallState,
  withDevtools,
  withLogoutReset,
} from '@nestfolio/shared-state';

export interface ProposedAction {
  actionType: string;
  symbol: string;
  side: string;
  quantity: number;
  limitPrice: number | null;
  currency: string;
}

export interface Decision {
  decisionId: string;
  tenantId: string;
  status: string;
  rationale: string | null;
  proposedActions: ProposedAction[];
  complianceStatus: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  rejectedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInvocation {
  invocationId: string;
  decisionId: string;
  agentName: string;
  tier: string;
  input: string | null;
  output: string | null;
  durationMs: number;
  status: string;
  invokedAt: string;
}

export interface ComplianceCheck {
  checkId: string;
  decisionId: string;
  ruleName: string;
  result: string;
  details: string | null;
  checkedAt: string;
}

interface AdvisoryState {
  decision: Decision | null;
  agentInvocations: AgentInvocation[];
  complianceChecks: ComplianceCheck[];
}

const initialState: AdvisoryState = {
  decision: null,
  agentInvocations: [],
  complianceChecks: [],
};

export const AdvisoryStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withCallState(),
  withComputed((store) => ({
    isLoaded: computed(() => store.decision() !== null),
    headline: computed(() => {
      const d = store.decision();
      if (!d) return '';
      const action = d.proposedActions[0];
      if (!action) return d.rationale ?? '';
      return `${action.side} ${action.symbol}`;
    }),
    statusSeverity: computed(() => {
      const status = store.decision()?.status;
      if (!status) return 'secondary' as const;
      switch (status) {
        case 'APPROVED':
        case 'CONFIRMED':
        case 'FILLED':
          return 'success' as const;
        case 'BLOCKED':
        case 'FAILED':
        case 'REJECTED':
          return 'danger' as const;
        case 'PROPOSED':
        case 'COMPLIANCE_REVIEW':
        case 'EXECUTING':
          return 'info' as const;
        case 'CONFIRMATION_REQUIRED':
        case 'AWAITING_CONFIRMATION':
          return 'warn' as const;
        default:
          return 'secondary' as const;
      }
    }),
    compliancePassed: computed(() => {
      const checks = store.complianceChecks();
      if (checks.length === 0) return null;
      return checks.every((c) => c.result === 'PASSED');
    }),
    totalDurationMs: computed(() => {
      return store.agentInvocations().reduce((sum, inv) => sum + inv.durationMs, 0);
    }),
    modelVersions: computed(() => {
      const invocations = store.agentInvocations();
      const unique = new Set(invocations.map((i) => i.tier));
      return [...unique];
    }),
  })),
  withMethods((store) => ({
    setDecision(decision: Decision): void {
      patchState(store, { decision });
    },
    setAgentInvocations(agentInvocations: AgentInvocation[]): void {
      patchState(store, { agentInvocations });
    },
    setComplianceChecks(complianceChecks: ComplianceCheck[]): void {
      patchState(store, { complianceChecks });
    },
    setLoading(v: boolean): void {
      if (v) {
        patchState(store, callLoading());
      } else {
        patchState(store, {
          callState: store.callError() ? ('error' as const) : ('loaded' as const),
        });
      }
    },
    setError(error: string | null): void {
      if (error) {
        patchState(store, callError(error));
      } else {
        patchState(store, { callError: null });
      }
    },
    reset(): void {
      patchState(store, { ...initialState, callState: 'init', callError: null });
    },
  })),
  withLogoutReset(() => ({
    ...initialState,
    callState: 'init' as const,
    callError: null,
  })),
  withDevtools('AdvisoryStore'),
);
