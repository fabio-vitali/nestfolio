import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

export interface DecisionStateMachineProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly serviceName: string;
}

/**
 * Step Functions state machine for the decision lifecycle.
 *
 * Flow:
 * 1. Parallel: InvestorProfile + MarketIntelligence (waitForTaskToken)
 * 2. Sequential: PortfolioEngine (waitForTaskToken)
 * 3. Sequential: AdvisoryNarrative (waitForTaskToken)
 * 4. AssemblePacket (Pass state — merges outputs)
 * 5. WaitForCompliance (waitForTaskToken)
 * 6. Choice: APPROVED L1 → end, BLOCKED → end, L2 → user confirmation
 * 7. WaitForUserResponse (waitForTaskToken)
 * 8. End
 */
export class DecisionStateMachine extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: DecisionStateMachineProps) {
    super(scope, id);

    const { eventBus, serviceName } = props;
    const busArn = `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${eventBus.eventBusName}`;

    // Helper: create a waitForTaskToken state that publishes an event to EventBridge
    const createAgentInvocationState = (
      stateId: string,
      detailType: string,
      timeout: Duration = Duration.minutes(10),
    ): sfn.CustomState => {
      // CustomState because the CDK L2 EventBridgePutEvents task does not natively
      // support waitForTaskToken with $.Task.Token injection. We use raw ASL.
      return new sfn.CustomState(this, stateId, {
        stateJson: {
          Type: 'Task',
          Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
          Parameters: {
            Entries: [
              {
                EventBusName: eventBus.eventBusName,
                Source: serviceName,
                DetailType: detailType,
                Detail: {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'taskToken.$': '$$.Task.Token',
                  'context.$': '$.context',
                  'upstreamOutputs.$': '$.upstreamOutputs',
                },
              },
            ],
          },
          TimeoutSeconds: timeout.toSeconds(),
          ResultPath: `$.agentResults.${stateId}`,
        },
      });
    };

    // --- Agent invocation states ---

    const invokeInvestorProfile = createAgentInvocationState(
      'InvokeInvestorProfile',
      'ANALYZE_INVESTOR_PROFILE',
    );

    const invokeMarketIntelligence = createAgentInvocationState(
      'InvokeMarketIntelligence',
      'ANALYZE_MARKET',
    );

    const invokePortfolioEngine = createAgentInvocationState(
      'InvokePortfolioEngine',
      'CONSTRUCT_PORTFOLIO',
    );

    const invokeAdvisoryNarrative = createAgentInvocationState(
      'InvokeAdvisoryNarrative',
      'GENERATE_NARRATIVE',
    );

    // --- Parallel: investor-profile + market-intelligence ---

    const parallelProfiling = new sfn.Parallel(this, 'ParallelProfiling', {
      resultPath: '$.parallelResults',
    });
    parallelProfiling.branch(invokeInvestorProfile);
    parallelProfiling.branch(invokeMarketIntelligence);

    // --- Merge parallel outputs ---

    const mergeParallelOutputs = new sfn.Pass(this, 'MergeParallelOutputs', {
      parameters: {
        'decisionId.$': '$.decisionId',
        'tenantId.$': '$.tenantId',
        'context.$': '$.context',
        'upstreamOutputs': {
          'investorProfile.$': '$.parallelResults[0].agentResults.InvokeInvestorProfile',
          'marketAnalysis.$': '$.parallelResults[1].agentResults.InvokeMarketIntelligence',
        },
      },
    });

    // --- Merge all outputs before compliance ---

    const assemblePacket = new sfn.Pass(this, 'AssembleDecisionPacket', {
      comment: 'Merge all agent outputs into a single decision packet payload',
    });

    // --- Compliance wait ---

    const publishRecommendation = new sfn.CustomState(this, 'PublishRecommendation', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'RECOMMENDATION_PROPOSED',
              Detail: {
                'decisionId.$': '$.decisionId',
                'tenantId.$': '$.tenantId',
              },
            },
          ],
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const waitForCompliance = new sfn.CustomState(this, 'WaitForCompliance', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'RECOMMENDATION_PROPOSED',
              Detail: {
                'decisionId.$': '$.decisionId',
                'tenantId.$': '$.tenantId',
                'taskToken.$': '$$.Task.Token',
                'awaitingCompliance': true,
              },
            },
          ],
        },
        TimeoutSeconds: Duration.hours(24).toSeconds(),
        ResultPath: '$.complianceResult',
      },
    });

    // --- Compliance choice ---

    const complianceChoice = new sfn.Choice(this, 'ComplianceChoice');

    const blockedEnd = new sfn.Pass(this, 'UpdateStatusBlocked', {
      comment: 'Decision blocked by compliance',
    }).next(new sfn.Succeed(this, 'EndBlocked'));

    const approvedL1End = new sfn.Pass(this, 'UpdateStatusApprovedL1', {
      comment: 'Decision approved (L1 autonomous)',
    }).next(new sfn.Succeed(this, 'EndApprovedL1'));

    // --- User confirmation ---

    const requestUserConfirmation = new sfn.CustomState(this, 'RequestUserConfirmation', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'USER_CONFIRMATION_REQUESTED',
              Detail: {
                'decisionId.$': '$.decisionId',
                'tenantId.$': '$.tenantId',
                'taskToken.$': '$$.Task.Token',
              },
            },
          ],
        },
        TimeoutSeconds: Duration.hours(72).toSeconds(),
        ResultPath: '$.userResponse',
      },
    });

    const updateFinalStatus = new sfn.Pass(this, 'UpdateFinalStatus', {
      comment: 'Final status from user response',
    });

    const endSuccess = new sfn.Succeed(this, 'EndSuccess');

    // --- Wire the chain ---

    const definition = parallelProfiling
      .next(mergeParallelOutputs)
      .next(invokePortfolioEngine)
      .next(invokeAdvisoryNarrative)
      .next(assemblePacket)
      .next(publishRecommendation)
      .next(waitForCompliance)
      .next(
        complianceChoice
          .when(sfn.Condition.stringEquals('$.complianceResult.decision', 'BLOCKED'), blockedEnd)
          .when(
            sfn.Condition.and(
              sfn.Condition.stringEquals('$.complianceResult.decision', 'APPROVED'),
              sfn.Condition.stringEquals('$.complianceResult.authorityLevel', 'L1'),
            ),
            approvedL1End,
          )
          .otherwise(
            requestUserConfirmation
              .next(updateFinalStatus)
              .next(endSuccess),
          ),
      );

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(72),
      tracingEnabled: true,
      stateMachineType: sfn.StateMachineType.STANDARD,
      comment: 'Decision lifecycle orchestration — advisory agent topology',
    });

    // Grant PutEvents to the state machine execution role
    this.stateMachine.addToRolePolicy(
      new (require('aws-cdk-lib/aws-iam').PolicyStatement)({
        actions: ['events:PutEvents'],
        resources: [busArn],
      }),
    );
  }
}
