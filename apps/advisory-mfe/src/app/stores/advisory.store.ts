import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  setError as callError,
  setLoading as callLoading,
  withCallState,
  withDevtools,
  withLogoutReset,
} from '@nestfolio/shell';

export interface ProposedTrade {
  symbol: string;
  assetClass: string;
  side: string;
  quantityOrAmountCents: number;
  targetWeightPercent: number;
  rationale: string;
}

export interface Decision {
  decisionId: string;
  tenantId: string;
  trigger: string;
  status: string;
  explanation: string;
  proposedTrades: ProposedTrade[];
  confirmationRequired: boolean;
  confirmedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInvocation {
  invocationId: string;
  decisionId: string;
  agentName: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ComplianceCheck {
  checkId: string;
  decisionId: string;
  level: string;
  ruleName: string;
  result: string;
  details: string | null;
  checkedAt: string;
}

interface AdvisoryState {
  decision: Decision | null;
  agentInvocations: AgentInvocation[];
  complianceChecks: ComplianceCheck[];
  successMessage: string;
}

const initialState: AdvisoryState = {
  decision: null,
  agentInvocations: [],
  complianceChecks: [],
  successMessage: '',
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
      const trade = d.proposedTrades[0];
      if (!trade) return d.explanation ?? '';
      return `${trade.side} ${trade.symbol}`;
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
    totalLatencyMs: computed(() => {
      return store.agentInvocations().reduce((sum, inv) => sum + inv.latencyMs, 0);
    }),
    modelVersions: computed(() => {
      const invocations = store.agentInvocations();
      const unique = new Set(invocations.map((i) => i.modelId));
      return [...unique];
    }),
    canAct: computed(() => {
      const d = store.decision();
      return d !== null && d.status === 'AWAITING_CONFIRMATION' && !store.loading();
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
    setSuccess(message: string): void {
      patchState(store, { successMessage: message });
      setTimeout(() => patchState(store, { successMessage: '' }), 3000);
    },
    clearSuccess(): void {
      patchState(store, { successMessage: '' });
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
