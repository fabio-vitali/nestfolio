import { join } from 'path';
import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs';

export class InvestorBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, { ...props, prefix: props.prefix, subsystem: 'investor', service: 'investor-bff', serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'USER_REGISTERED',
        'NOTIFICATION_CREATED',
        'BALANCE_UPDATED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
      handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
    });

    new Facade(this, 'Facade', {
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['recordOnboardingAnswer', 'requestAccountClosure'],
      }),
    });

    this.addObservability({ ingress, egress });
  }
}
