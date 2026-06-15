import { Stack, StackProps, Aspects } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus, IEventBus } from 'aws-cdk-lib/aws-events';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Ingress } from './ingress';
import { Egress } from './egress';
import { Orchestration } from './orchestration';
import { Broadcaster } from './broadcaster';
import { NonProdAutoDeleteAspect } from './non-prod-auto-delete';
import { Monitoring } from '../observability/monitoring';
import { ServiceDashboard } from '../observability/dashboard';
import { NamingService, isProductionPrefix } from '../utils/naming-service';
import { applyStandardTags } from '../utils/tagging';

export interface ServiceStackProps extends StackProps {
  prefix: string;
  subsystem: string;
  service: string;
  serviceDir?: string;
  domain?: string;
  eventBus?: IEventBus;
  /** Enable observability (Monitoring + Dashboard). Defaults to true. */
  observability?: boolean;
  /** Enable WAF rate limiting on Facade APIs. Defaults to false. */
  waf?: boolean;
  /**
   * Whether this is a PRODUCTION environment. Drives env-aware RemovalPolicy:
   * production RETAINs stateful resources; non-prod DESTROYs them so replaced
   * resources clean up instead of orphaning. Defaults to `isProductionPrefix(prefix)`.
   * Real deploys pass the value resolved from the pipeline tier.
   */
  production?: boolean;
}

export class ServiceStack extends Stack {
  readonly prefix: string;
  readonly naming: NamingService;
  readonly serviceName: string;
  readonly serviceDir: string;
  readonly observability: boolean;
  readonly waf: boolean;
  /** True only for production environments — see ServiceStackProps.production. */
  readonly production: boolean;
  private _eventBus?: IEventBus;

  get eventBus(): IEventBus {
    if (!this._eventBus) {
      this._eventBus = EventBus.fromEventBusName(this, 'EventBus', this.naming.eventBusName());
    }
    return this._eventBus;
  }

  /** Allow subclasses to set event bus after super() (e.g. SSM ARN lookup) */
  protected set eventBus(bus: IEventBus) {
    this._eventBus = bus;
  }

  /** Walk up the construct tree to find the nearest ServiceStack ancestor */
  static of(construct: Construct): ServiceStack {
    const stack = Stack.of(construct);
    if (stack instanceof ServiceStack) return stack;
    throw new Error(`${construct.node.path} is not within a ServiceStack`);
  }

  /**
   * Returns the `production` flag of the enclosing ServiceStack, or `false`
   * (non-production) when the construct is not inside a ServiceStack — e.g. a
   * plain `Stack` in a unit test. Lets stateful constructs (State, knowledge-base,
   * mfe-bucket) pick an env-aware RemovalPolicy without each consumer threading
   * the flag through props.
   */
  static productionOf(construct: Construct): boolean {
    const stack = Stack.of(construct);
    return stack instanceof ServiceStack ? stack.production : false;
  }

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    this.serviceName = props.service;
    this.serviceDir = props.serviceDir ?? '';
    this.observability = props.observability ?? true;
    this.waf = props.waf ?? false;
    this.prefix = props.prefix;
    this.production = props.production ?? isProductionPrefix(props.prefix);

    this.naming = new NamingService({
      prefix: props.prefix,
      subsystem: props.subsystem,
      service: props.service,
    });

    applyStandardTags(this, {
      service: props.service,
      domain: props.domain ?? props.subsystem,
      environment: this.prefix,
    });

    if (props.eventBus) {
      this._eventBus = props.eventBus;
    }

    // Non-production: force DESTROY on stateful resources (DynamoDB tables, CFN
    // log groups) so replacements self-clean instead of orphaning. Production
    // keeps the construct defaults (RETAIN). See NonProdAutoDeleteAspect.
    if (!this.production) {
      Aspects.of(this).add(new NonProdAutoDeleteAspect());
    }
  }

  addObservability(opts: {
    ingress?: Ingress;
    egress?: Egress;
    orchestration?: Orchestration;
    broadcasters?: Broadcaster[];
    extraLambdas?: IFunction[];
    extraDlqs?: IQueue[];
    monitorBedrock?: boolean;
    bedrockModelIds?: string[];
  }): void {
    if (!this.observability) return;

    const lambdaFunctions: IFunction[] = [];
    const dlqs: IQueue[] = [];

    if (opts.ingress) {
      lambdaFunctions.push(opts.ingress.handler);
      dlqs.push(opts.ingress.dlq);
    }
    if (opts.egress) {
      dlqs.push(opts.egress.dlq);
    }
    if (opts.orchestration) {
      dlqs.push(opts.orchestration.dlq);
    }
    for (const broadcaster of opts.broadcasters ?? []) {
      lambdaFunctions.push(broadcaster.handler);
      dlqs.push(broadcaster.dlq);
    }
    if (opts.extraLambdas) {
      lambdaFunctions.push(...opts.extraLambdas);
    }
    if (opts.extraDlqs) {
      dlqs.push(...opts.extraDlqs);
    }

    const sfAlarmConfig = opts.orchestration ? {
      stateMachineArn: opts.orchestration.stateMachine.stateMachineArn,
      stateMachineName: opts.orchestration.stateMachine.stateMachineName,
    } : undefined;

    new Monitoring(this, 'Monitoring', {
      lambdaFunctions,
      dlqs,
      monitorBedrock: opts.monitorBedrock,
      bedrockModelIds: opts.bedrockModelIds,
      stepFunctions: sfAlarmConfig,
    });

    new ServiceDashboard(this, 'Dashboard', {
      serviceName: this.serviceName,
      lambdaFunctions,
      dlqs,
      stepFunctions: sfAlarmConfig,
    });
  }
}
