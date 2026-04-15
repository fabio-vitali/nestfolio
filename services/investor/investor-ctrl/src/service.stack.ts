import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { InvestorCtrlEventTypes } from './domain/events';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

export class InvestorCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const triggerIngress = new Ingress(this, 'TriggerIngress', {
      state,
      eventTypes: [
        InvestorBffEventTypes.ONBOARDING_COMPLETED,
        InvestorBffEventTypes.MANDATE_CREATED,
        InvestorBffEventTypes.GOAL_UPDATED,
        InvestorBffEventTypes.DEPOSIT_INITIATED,
        InvestorBffEventTypes.OPERATING_MODE_CHANGED,
        InvestorIngestEventTypes.DECISION_APPROVED,
        InvestorIngestEventTypes.ORDER_FILLED,
        InvestorIngestEventTypes.BALANCE_UPDATED,
        InvestorIngestEventTypes.ORDER_REJECTED,
        InvestorIngestEventTypes.DECISION_BLOCKED,
        InvestorIngestEventTypes.WITHDRAWAL_COMPLETED,
        InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN,
        InvestorIngestEventTypes.BROKER_CIRCUIT_CLOSED,
        InvestorIngestEventTypes.BROKER_HEAL_ESCALATED,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'Notification': {
          insert: InvestorCtrlEventTypes.NOTIFICATION_CREATED,
          modify: InvestorCtrlEventTypes.NOTIFICATION_UPDATED,
        },
        'MonthlyReport': {
          insert: InvestorCtrlEventTypes.MONTHLY_REPORT_CREATED,
          modify: InvestorCtrlEventTypes.MONTHLY_REPORT_UPDATED,
        },
      },
    });

    this.addObservability({ ingress: triggerIngress, egress });
  }
}
