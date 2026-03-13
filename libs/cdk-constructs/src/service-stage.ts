import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** Values passed to stackFactory so stacks receive config via direct props */
export interface StageContext {
  prefix: string;
  production: boolean;
  observability: boolean;
}

export interface ServiceStageProps extends StageProps {
  /** Environment prefix (e.g. 'dev', 'staging', 'prod', 'sandbox-pr-42') */
  prefix: string;
  /** Whether this is a production deployment (enables termination protection) */
  production: boolean;
  /** Enable observability (Monitoring + Dashboard). Defaults to true. */
  observability?: boolean;
  /** Factory that creates the service stack(s) inside this stage */
  stackFactory: (scope: Stage, ctx: StageContext) => void;
}

export class ServiceStage extends Stage {
  readonly prefix: string;
  readonly production: boolean;
  readonly observability: boolean;

  constructor(scope: Construct, id: string, props: ServiceStageProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.production = props.production;
    this.observability = props.observability ?? true;

    // Set prefix and observability on context so hub stacks (which read from context) also work
    this.node.setContext('prefix', props.prefix);
    this.node.setContext('observability', String(this.observability));

    props.stackFactory(this, {
      prefix: this.prefix,
      production: this.production,
      observability: this.observability,
    });
  }
}
