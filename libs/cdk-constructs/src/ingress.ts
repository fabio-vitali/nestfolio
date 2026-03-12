import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { State } from './state';
import { defaultLambdaProps } from './default-lambda-props';

export interface IngressProps {
  eventBus: IEventBus;
  eventTypes: string[];
  /** Path to the event listener handler file */
  entry: string;
  /** Service name — sets SERVICE_NAME env var */
  serviceName: string;
  /** State construct — auto-wires TABLE_NAME/BUCKET_NAME env vars and IAM grants */
  state: State;
  /** Extra environment variables merged into the Lambda */
  environment?: Record<string, string>;
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  batchSize?: number;
  maxBatchingWindowMs?: number;
  /** Maximum batching window as CDK Duration. Takes precedence over maxBatchingWindowMs. */
  maxBatchingWindow?: Duration;
  maxRetries?: number;
  /** Visibility timeout for the SQS queue. If not set but lambdaTimeout is provided, auto-calculated as 6x lambdaTimeout. */
  visibilityTimeout?: Duration;
  /** Lambda timeout. Used to auto-calculate visibilityTimeout = 6 x lambdaTimeout when visibilityTimeout is not set. */
  lambdaTimeout?: Duration;
}

export class Ingress extends Construct {
  readonly handler: NodejsFunction;
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

    // Build environment from State + bus + extras
    const env: Record<string, string> = {
      SERVICE_NAME: props.serviceName,
      BUS_NAME: props.eventBus.eventBusName,
    };
    if (props.state.table) {
      env['TABLE_NAME'] = props.state.getTable().tableName;
    }
    if (props.state.bucket) {
      env['BUCKET_NAME'] = props.state.getBucket().bucketName;
    }
    if (props.environment) {
      Object.assign(env, props.environment);
    }

    // Create Lambda
    this.handler = new NodejsFunction(this, 'Handler', {
      ...defaultLambdaProps(this),
      ...props.lambdaProps,
      entry: props.entry,
      environment: env,
    });

    // IAM: State grants
    if (props.state.table) {
      props.state.getTable().grantReadWriteData(this.handler);
    }
    if (props.state.bucket) {
      props.state.getBucket().grantReadWrite(this.handler);
    }

    // IAM: PutEvents for publishErrorEvent
    this.handler.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [
        `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${props.eventBus.eventBusName}`,
      ],
    }));

    // SQS: DLQ + Queue
    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const visibilityTimeout = props.visibilityTimeout
      ?? (props.lambdaTimeout
        ? Duration.seconds(6 * props.lambdaTimeout.toSeconds())
        : Duration.seconds(180));

    this.queue = new Queue(this, 'Queue', {
      visibilityTimeout,
      encryption: QueueEncryption.KMS_MANAGED,
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: props.maxRetries ?? 10,
      },
    });

    // EventBridge Rule → SQS
    new Rule(this, 'Rule', {
      eventBus: props.eventBus,
      eventPattern: { detailType: props.eventTypes },
      targets: [new SqsQueue(this.queue)],
    });

    // SQS → Lambda
    const batchingWindow = props.maxBatchingWindow
      ?? Duration.millis(props.maxBatchingWindowMs ?? 1000);

    this.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: batchingWindow,
      reportBatchItemFailures: true,
    }));
  }
}
