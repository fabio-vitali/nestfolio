import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface IngressProps {
  eventBus: IEventBus;
  eventTypes: string[];
  handler: IFunction;
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
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

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

    new Rule(this, 'Rule', {
      eventBus: props.eventBus,
      eventPattern: {
        detailType: props.eventTypes,
      },
      targets: [new SqsQueue(this.queue)],
    });

    const batchingWindow = props.maxBatchingWindow
      ?? Duration.millis(props.maxBatchingWindowMs ?? 1000);

    props.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: batchingWindow,
      reportBatchItemFailures: true,
    }));
  }
}
