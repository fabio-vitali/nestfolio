import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus, IEventBus } from 'aws-cdk-lib/aws-events';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { State, StateProps } from './state';
import { Ingress } from './ingress';
import { Egress } from './egress';
import { Monitoring } from './monitoring';
import { ServiceDashboard } from './dashboard';
import { NamingService } from './naming-service';
import { applyStandardTags } from './tagging';

export interface ServiceStackProps extends StackProps {
  prefix: string;
  subsystem: string;
  service: string;
  serviceDir?: string;
  domain?: string;
  stateProps?: StateProps | false;
  eventBus?: IEventBus;
  /** Enable observability (Monitoring + Dashboard). Defaults to true. */
  observability?: boolean;
}

export class ServiceStack extends Stack {
  readonly prefix: string;
  readonly naming: NamingService;
  readonly state!: State;
  readonly serviceName: string;
  readonly serviceDir: string;
  readonly observability: boolean;
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

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    this.serviceName = props.service;
    this.serviceDir = props.serviceDir ?? '';
    this.observability = props.observability ?? true;
    this.prefix = props.prefix;

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

    if (props.stateProps !== false) {
      this.state = new State(this, 'State', props.stateProps);
    }

    if (props.eventBus) {
      this._eventBus = props.eventBus;
    }
  }

  addObservability(opts: {
    ingress?: Ingress;
    egress?: Egress;
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
    if (opts.extraLambdas) {
      lambdaFunctions.push(...opts.extraLambdas);
    }
    if (opts.extraDlqs) {
      dlqs.push(...opts.extraDlqs);
    }

    new Monitoring(this, 'Monitoring', {
      lambdaFunctions,
      dlqs,
      monitorBedrock: opts.monitorBedrock,
      bedrockModelIds: opts.bedrockModelIds,
    });

    new ServiceDashboard(this, 'Dashboard', {
      serviceName: this.serviceName,
      lambdaFunctions,
      dlqs,
    });
  }
}
