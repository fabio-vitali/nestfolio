import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { defaultLambdaProps } from '../utils/default-lambda-props';
import { State } from './state';
import { Facade } from './facade';

export interface BroadcasterProps {
  /** State construct — supplies the DynamoDB table whose stream drives the broadcast. */
  state: State;
  /** Path to the publisher handler file (e.g. handlers/dashboard-publisher.ts). */
  entry: string;
  /**
   * Facade — supplies the AppSync endpoint. `facade.graphqlUrl` is injected as the
   * `APPSYNC_URL` env var; when `facade.api` is present the handler is granted
   * `appsync:GraphQL` so it can invoke the publish mutations.
   */
  facade: Facade;
  /** Extra environment variables merged into the publisher Lambda. */
  environment?: Record<string, string>;
  /** Override defaultLambdaProps (e.g. timeout, memorySize). */
  lambdaProps?: Partial<NodejsFunctionProps>;
  /** DynamoDB Streams retry attempts before a record batch is sent to the DLQ. Default: 3. */
  retryAttempts?: number;
}

/**
 * Broadcaster — a DynamoDB-stream-driven publisher that fans read-model row
 * mutations out to clients via AppSync `@aws_subscribe` mutations.
 *
 * The 7th member of the service construct family (State / Ingress / Egress /
 * Facade / AgentRuntime / Orchestration / Broadcaster). It encapsulates the
 * publisher Lambda, its DDB stream event source, and — mirroring `Egress` — a
 * dead-letter queue with `bisectBatchOnError` so a single poison-pill record
 * cannot drop the whole batch of good broadcasts. Broadcasts are best-effort
 * post-commit side effects: the persisted read-model row remains the source of
 * truth and a dropped broadcast is a missed *live* update, not lost data — the
 * DLQ + alarm make those drops visible instead of silent.
 *
 * Wire the construct into observability via `addObservability({ broadcasters: [...] })`
 * so the `Monitoring` construct alarms on DLQ depth and publisher Lambda errors.
 */
export class Broadcaster extends Construct {
  readonly handler: NodejsFunction;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: BroadcasterProps) {
    super(scope, id);

    const { state, facade } = props;

    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const env: Record<string, string> = {};
    if (facade.graphqlUrl) {
      env['APPSYNC_URL'] = facade.graphqlUrl;
    }
    if (props.environment) {
      Object.assign(env, props.environment);
    }

    this.handler = new NodejsFunction(this, 'Publisher', {
      ...defaultLambdaProps(this),
      ...props.lambdaProps,
      entry: props.entry,
      environment: env,
    });

    this.handler.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        bisectBatchOnError: true,
        retryAttempts: props.retryAttempts ?? 3,
        onFailure: new SqsDlq(this.dlq),
      }),
    );

    // AppSync invoke grant — the publisher calls the publish mutations over IAM.
    if (facade.api) {
      this.handler.addToRolePolicy(
        new PolicyStatement({
          actions: ['appsync:GraphQL'],
          resources: [`${facade.api.arn}/*`],
        }),
      );
    }
  }
}
