import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

interface DecisionWorkflowDefinitionProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly serviceName: string;
  readonly assemblePacketFnArn: string;
}

/**
 * Step Functions state machine for the decision lifecycle.
 *
 * Flow:
 * 1. Parallel: InvestorProfile + MarketIntelligence (waitForTaskToken)
 * 2. Sequential: PortfolioEngine (waitForTaskToken)
 * 3. Sequential: AdvisoryNarrative (waitForTaskToken)
 * 4. AssemblePacket (Lambda Task state — reads outputs from Memory)
 * 5. WaitForCompliance (waitForTaskToken)
 * 6. Choice: APPROVED L1 → end, BLOCKED → end, L2 → user confirmation
 * 7. WaitForUserResponse (waitForTaskToken)
 * 8. End
 */
export class DecisionWorkflowDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;

  constructor(scope: Construct, id: string, props: DecisionWorkflowDefinitionProps) {
    super(scope, id);

    const { eventBus, serviceName } = props;

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
                  'id.$': 'States.UUID()',
                  'type': detailType,
                  'timestamp.$': '$$.State.EnteredTime',
                  'subject': {
                    'decisionId.$': '$.decisionId',
                    'tenantId.$': '$.tenantId',
                    'taskToken.$': '$$.Task.Token',
                  },
                  'context': {
                    'tenantId.$': '$.tenantId',
                    'userId.$': '$.userId',
                    'region.$': '$.region',
                  },
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

    // ANALYZE_INVESTOR_PROFILE carries the trigger event's full subject as
    // `investorProfile` so investor-profile-ctrl can read `operatingMode` (and
    // any other profile fields) for downstream propagation via AgentCore Memory.
    // For non-INVESTOR_PROFILE_* triggers (DEPOSIT_DETECTED etc.), triggerContext
    // is the deposit/order subject — investor-profile-ctrl handler defaults
    // operatingMode to 'BALANCED' on missing field.
    const invokeInvestorProfile = new sfn.CustomState(this, 'InvokeInvestorProfile', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'ANALYZE_INVESTOR_PROFILE',
              Detail: {
                'id.$': 'States.UUID()',
                'type': 'ANALYZE_INVESTOR_PROFILE',
                'timestamp.$': '$$.State.EnteredTime',
                'subject': {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'taskToken.$': '$$.Task.Token',
                  'investorProfile.$': '$.triggerContext',
                },
                'context': {
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'region.$': '$.region',
                },
              },
            },
          ],
        },
        TimeoutSeconds: Duration.minutes(10).toSeconds(),
        ResultPath: '$.agentResults.InvokeInvestorProfile',
      },
    });

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
        'userId.$': '$.userId',
        'region.$': '$.region',
        'trigger.$': '$.trigger',
      },
    });

    // --- Merge all outputs before compliance ---

    // AssemblePacket invocation. The Lambda writes a DecisionPacket DDB row
    // (idempotent) AND returns the compliance inputs (proposedTrades,
    // portfolioValue, riskScore, currentPositions) extracted from the agents'
    // memory outputs. ResultSelector flattens the lambda:invoke envelope so we
    // address the fields directly via $.decisionPacket.<field>. ResultPath
    // captures only this packet — the existing top-level state ({decisionId,
    // tenantId, userId, region, trigger, triggerContext}) flows through
    // unchanged.
    // triggerEventId === decisionId per event-listener.ts (both are the trigger
    // event's id), so we reuse $.decisionId.
    const assemblePacket = new sfn.CustomState(this, 'AssembleDecisionPacket', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: props.assemblePacketFnArn,
          Payload: {
            'decisionId.$': '$.decisionId',
            'tenantId.$': '$.tenantId',
            'userId.$': '$.userId',
            'region.$': '$.region',
            'trigger.$': '$.trigger',
            'triggerEventId.$': '$.decisionId',
            'executionArn.$': '$$.Execution.Id',
          },
        },
        ResultSelector: {
          'proposedTrades.$': '$.Payload.proposedTrades',
          'portfolioValue.$': '$.Payload.portfolioValue',
          'riskScore.$': '$.Payload.riskScore',
          'currentPositions.$': '$.Payload.currentPositions',
        },
        ResultPath: '$.decisionPacket',
      },
    });

    // --- Compliance wait ---
    //
    // Single emission: RECOMMENDATION_PROPOSED carries taskToken AND the
    // packet data compliance-ctrl needs. compliance-ctrl subscribes to this
    // detailType, runs the rule engine, persists ComplianceCheck with
    // taskToken, and CDC re-emits DECISION_APPROVED|BLOCKED with taskToken on
    // subject — closing the SF callback loop.

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
                'id.$': 'States.UUID()',
                'type': 'RECOMMENDATION_PROPOSED',
                'timestamp.$': '$$.State.EnteredTime',
                'subject': {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'taskToken.$': '$$.Task.Token',
                  'awaitingCompliance': true,
                  'proposedTrades.$': '$.decisionPacket.proposedTrades',
                  'portfolioValue.$': '$.decisionPacket.portfolioValue',
                  'riskScore.$': '$.decisionPacket.riskScore',
                  'currentPositions.$': '$.decisionPacket.currentPositions',
                },
                'context': {
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'region.$': '$.region',
                },
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
                'id.$': 'States.UUID()',
                'type': 'USER_CONFIRMATION_REQUESTED',
                'timestamp.$': '$$.State.EnteredTime',
                'subject': {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'taskToken.$': '$$.Task.Token',
                },
                'context': {
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'region.$': '$.region',
                },
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

    // --- Entry: unpack EB envelope ({id,type,timestamp,subject,context}) into
    //     top-level {decisionId, tenantId, trigger, triggerContext} so downstream
    //     states can reference $.decisionId and $.tenantId directly.
    //     Post-collapse (Phase 2): trigger events arrive directly from EB→SF
    //     and do NOT carry a pre-generated decisionId — the legacy TriggerIngress
    //     Lambda that minted one was removed. We generate a fresh decisionId here
    //     via States.UUID() so each SF execution owns a stable ID for its
    //     downstream agent invocations + DecisionPacket persistence.
    //     `trigger` is the trigger event's detailType (e.g. DEPOSIT_DETECTED);
    //     `triggerContext` carries the full trigger payload for downstream agents
    //     that need fields beyond decisionId/tenantId/userId. ---
    const unpackTriggerEnvelope = new sfn.Pass(this, 'UnpackTriggerEnvelope', {
      parameters: {
        'decisionId.$': 'States.UUID()',
        'tenantId.$': '$.context.tenantId',
        // userId + region come from CDC envelope's top-level context — required by
        // libs/event-processor/src/engine/parse-sqs-record.ts envelope validation
        // on every downstream event we emit (agent invocations, compliance, user confirm).
        'userId.$': '$.context.userId',
        'region.$': '$.context.region',
        'trigger.$': '$.type',
        'triggerContext.$': '$.subject',
      },
    });

    // --- Wire the chain ---

    const definition = unpackTriggerEnvelope
      .next(parallelProfiling)
      .next(mergeParallelOutputs)
      .next(invokePortfolioEngine)
      .next(invokeAdvisoryNarrative)
      .next(assemblePacket)
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

    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
