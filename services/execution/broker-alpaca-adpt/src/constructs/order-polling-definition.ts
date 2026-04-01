import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface OrderPollingDefinitionProps {
  readonly pollHandlerFn: IFunction;
}

export class OrderPollingDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;

  constructor(scope: Construct, id: string, props: OrderPollingDefinitionProps) {
    super(scope, id);

    const { pollHandlerFn } = props;

    // 1. Extract input fields from CDC event detail
    const extractInput = new sfn.Pass(this, 'ExtractInput', {
      parameters: {
        'tenantId.$': '$.context.tenantId',
        'nestfolioOrderId.$': '$.subject.nestfolioOrderId',
        'alpacaOrderId.$': '$.subject.alpacaOrderId',
        'backoffSeconds': 10,
      },
    });

    // 2. Wait with dynamic backoff
    const wait = new sfn.Wait(this, 'Wait', {
      time: sfn.WaitTime.secondsPath('$.backoffSeconds'),
    });

    // 3. Poll order status
    const pollOrderStatus = new tasks.LambdaInvoke(this, 'PollOrderStatus', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'poll',
        'tenantId.$': '$.tenantId',
        'nestfolioOrderId.$': '$.nestfolioOrderId',
        'alpacaOrderId.$': '$.alpacaOrderId',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultSelector: {
        'status.$': '$.Payload.status',
        'tenantId.$': '$.Payload.tenantId',
        'nestfolioOrderId.$': '$.Payload.nestfolioOrderId',
        'alpacaOrderId.$': '$.Payload.alpacaOrderId',
        'filledQuantity.$': '$.Payload.filledQuantity',
        'averageFillPrice.$': '$.Payload.averageFillPrice',
        'rejectionReason.$': '$.Payload.rejectionReason',
        'backoffSeconds.$': '$.Payload.backoffSeconds',
      },
      resultPath: '$',
      retryOnServiceExceptions: false,
    });

    pollOrderStatus.addRetry({
      errors: ['States.TaskFailed'],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    });

    // 4. Write terminal result
    const writeTerminalResult = new tasks.LambdaInvoke(this, 'WriteTerminalResult', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'write',
        'tenantId.$': '$.tenantId',
        'nestfolioOrderId.$': '$.nestfolioOrderId',
        'alpacaOrderId.$': '$.alpacaOrderId',
        'status.$': '$.status',
        'filledQuantity.$': '$.filledQuantity',
        'averageFillPrice.$': '$.averageFillPrice',
        'rejectionReason.$': '$.rejectionReason',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    const endTerminal = new sfn.Succeed(this, 'EndTerminal');

    // 5. Write partial fill (then resume polling)
    const writePartialFill = new tasks.LambdaInvoke(this, 'WritePartialFill', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'write',
        'tenantId.$': '$.tenantId',
        'nestfolioOrderId.$': '$.nestfolioOrderId',
        'alpacaOrderId.$': '$.alpacaOrderId',
        'status.$': '$.status',
        'filledQuantity.$': '$.filledQuantity',
        'averageFillPrice.$': '$.averageFillPrice',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    // 6. Reset backoff after partial fill
    const resetBackoff = new sfn.Pass(this, 'ResetBackoff', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'nestfolioOrderId.$': '$.nestfolioOrderId',
        'alpacaOrderId.$': '$.alpacaOrderId',
        'backoffSeconds': 10,
      },
    });

    // 7. Increment backoff (min(backoffSeconds * 2, 300))
    const incrementBackoff = new sfn.Pass(this, 'IncrementBackoff', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'nestfolioOrderId.$': '$.nestfolioOrderId',
        'alpacaOrderId.$': '$.alpacaOrderId',
        'backoffSeconds.$': 'States.MathAdd($.backoffSeconds, $.backoffSeconds)',
      },
    });

    // Cap backoff at 300s
    const capBackoff = new sfn.Choice(this, 'CapBackoff')
      .when(sfn.Condition.numberGreaterThan('$.backoffSeconds', 300),
        new sfn.Pass(this, 'SetMaxBackoff', {
          parameters: {
            'tenantId.$': '$.tenantId',
            'nestfolioOrderId.$': '$.nestfolioOrderId',
            'alpacaOrderId.$': '$.alpacaOrderId',
            'backoffSeconds': 300,
          },
        }).next(wait))
      .otherwise(wait);

    // 8. Handle timeout — cancel at Alpaca
    const handleTimeout = new tasks.LambdaInvoke(this, 'HandleTimeout', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'timeout',
        'tenantId.$': '$.tenantId',
        'nestfolioOrderId.$': '$.nestfolioOrderId',
        'alpacaOrderId.$': '$.alpacaOrderId',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    const endTimeout = new sfn.Succeed(this, 'EndTimeout');

    // 9. Check status choice
    const checkStatus = new sfn.Choice(this, 'CheckStatus')
      .when(sfn.Condition.or(
        sfn.Condition.stringEquals('$.status', 'FILLED'),
        sfn.Condition.stringEquals('$.status', 'REJECTED'),
        sfn.Condition.stringEquals('$.status', 'CANCELLED'),
      ), writeTerminalResult)
      .when(sfn.Condition.stringEquals('$.status', 'PARTIALLY_FILLED'), writePartialFill)
      .otherwise(incrementBackoff);

    // Wire the chain
    writeTerminalResult.next(endTerminal);
    writePartialFill.next(resetBackoff);
    resetBackoff.next(wait);
    incrementBackoff.next(capBackoff);
    handleTimeout.next(endTimeout);

    // Add catch for overall timeout
    pollOrderStatus.addCatch(handleTimeout, {
      errors: ['States.Timeout'],
      resultPath: '$.error',
    });

    wait.next(pollOrderStatus);
    pollOrderStatus.next(checkStatus);

    const definition = extractInput.next(wait);

    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
