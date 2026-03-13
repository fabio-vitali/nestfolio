import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs';

export class InvestorBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props, subsystem: 'investor', service: 'investor-bff', serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'USER_REGISTERED',
        'NOTIFICATION_CREATED',
        'BALANCE_UPDATED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
      customEventTypeMap: {
        'Deposit:INSERT': 'DEPOSIT_INITIATED',
        'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
      },
    });

    new Facade(this, 'Facade', {
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['recordOnboardingAnswer', 'requestAccountClosure'],
      }),
    });

    this.addObservability({ ingress, egress });
  }
}
