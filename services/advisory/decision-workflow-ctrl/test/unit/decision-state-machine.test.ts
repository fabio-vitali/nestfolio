/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DecisionWorkflowCtrlStack } from '../../src/service.stack';

/**
 * Task 9 — Step Functions state-machine assertions.
 *
 * After the projection-precomputation rewire, the SF reads InvestorProfile +
 * Market snapshot rows from its own DDB table (no cross-service IAM), and
 * supports a payload-first hoist path for trigger-carried data. PE + AN are
 * unchanged from the SF's perspective — they keep their
 * `putEvents.waitForTaskToken` shape; only the agent-side callback transport
 * changed (Tasks 6, 7, 10).
 */
describe('Decision SF state machine (post-precomputation rewire)', () => {
  let template: Template;
  let definition: any;

  beforeAll(() => {
    const app = new App();
    const stack = new DecisionWorkflowCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'decision-workflow-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    template = Template.fromStack(stack);

    // DefinitionString is a CFN Fn::Join mixing JSON-string fragments with CFN
    // intrinsic Refs ({Ref: ...}). Swap each intrinsic for a synthetic string
    // token before parsing — same trick service.stack.test.ts uses.
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const definitionString = Object.values(stateMachines)[0]?.Properties?.DefinitionString;
    const joinParts: any[] = (definitionString as any)['Fn::Join']?.[1] ?? [];
    const joined = joinParts
      .map((p, i) => (typeof p === 'string' ? p : `__CFN_INTRINSIC_${i}__`))
      .join('');
    definition = JSON.parse(joined);
  });

  // ---- Removed legacy states --------------------------------------------

  it('removes ParallelProfiling + InvokeInvestorProfile + InvokeMarketIntelligence + MergeParallelOutputs states', () => {
    expect(definition.States.ParallelProfiling).toBeUndefined();
    expect(definition.States.InvokeInvestorProfile).toBeUndefined();
    expect(definition.States.InvokeMarketIntelligence).toBeUndefined();
    expect(definition.States.MergeParallelOutputs).toBeUndefined();
  });

  // ---- New projection-read states ---------------------------------------
  //
  // ResolveInvestorProfile, HoistInvestorProfileFromTrigger, and
  // LookupInvestorProfileSnapshot live inside ParallelProjections.Branches[0].States.
  // LookupMarketSnapshot lives inside ParallelProjections.Branches[1].States.

  it('adds ResolveInvestorProfile as a Choice with one .when + LookupInvestorProfileSnapshot default', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const state = branchStates.ResolveInvestorProfile;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Choice');
    expect(state.Choices).toHaveLength(1);
    expect(state.Default).toBe('LookupInvestorProfileSnapshot');
  });

  it('adds HoistInvestorProfileFromTrigger as a Pass state', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const state = branchStates.HoistInvestorProfileFromTrigger;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Pass');
    expect(state.Parameters?.agentOutput).toBeDefined();
  });

  it('adds LookupInvestorProfileSnapshot — DDB GetItem on InvestorProfileSnapshot key, captures full response on $.investorProfileSnapshotResponse (no ResultSelector — that would raise the uncatchable States.Runtime on absent rows)', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const state = branchStates.LookupInvestorProfileSnapshot;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Task');
    // sfnTasks.DynamoGetItem renders Resource via { Fn::Sub } using the
    // aws-partition intrinsic, so the partition slot is a CFN ref token here.
    expect(state.Resource).toMatch(/states:::dynamodb:getItem$/);
    expect(state.Parameters.Key.pk['S.$']).toBe(
      "States.Format('InvestorProfileSnapshot#{}#{}', $.tenantId, $.userId)",
    );
    expect(state.Parameters.Key.sk.S).toBe('InvestorProfileSnapshot');
    // No ResultSelector — evaluating States.StringToJson($.Item.agentOutput.S)
    // on a missing row raises States.Runtime, which AWS docs say is NOT catchable.
    // Defer the extraction to a downstream Pass guarded by a Choice on
    // isPresent($.investorProfileSnapshotResponse.Item.agentOutput.S).
    expect(state.ResultSelector).toBeUndefined();
    expect(state.ResultPath).toBe('$.investorProfileSnapshotResponse');
    expect(state.Next).toBe('CheckInvestorProfileSnapshotPresent');
  });

  it('Branch A fault-tolerance: Choice on $.investorProfileSnapshotResponse.Item.agentOutput.S → ExtractInvestorProfileSnapshot or HandleMissingInvestorProfileSnapshot (both write empty-tolerant shape under $.agentResults.InvokeInvestorProfile)', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;

    const choice = branchStates.CheckInvestorProfileSnapshotPresent;
    expect(choice).toBeDefined();
    expect(choice.Type).toBe('Choice');
    expect(choice.Choices).toHaveLength(1);
    expect(choice.Choices[0].Variable).toBe('$.investorProfileSnapshotResponse.Item.agentOutput.S');
    expect(choice.Choices[0].IsPresent).toBe(true);
    expect(choice.Choices[0].Next).toBe('ExtractInvestorProfileSnapshot');
    expect(choice.Default).toBe('HandleMissingInvestorProfileSnapshot');

    const extract = branchStates.ExtractInvestorProfileSnapshot;
    expect(extract).toBeDefined();
    expect(extract.Type).toBe('Pass');
    expect(extract.Parameters['agentOutput.$']).toBe(
      'States.StringToJson($.investorProfileSnapshotResponse.Item.agentOutput.S)',
    );
    expect(extract.ResultPath).toBe('$.agentResults.InvokeInvestorProfile');
    expect(extract.End).toBe(true);

    const fallback = branchStates.HandleMissingInvestorProfileSnapshot;
    expect(fallback).toBeDefined();
    expect(fallback.Type).toBe('Pass');
    expect(fallback.Result).toEqual({ agentOutput: {} });
    expect(fallback.ResultPath).toBe('$.agentResults.InvokeInvestorProfile');
    expect(fallback.End).toBe(true);
  });

  it('ExtractInvestorProfileSnapshot Pass parses agentOutput.S via States.StringToJson', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const extract = branchStates.ExtractInvestorProfileSnapshot;
    expect(extract.Type).toBe('Pass');
    expect(extract.Parameters['agentOutput.$']).toBe(
      'States.StringToJson($.investorProfileSnapshotResponse.Item.agentOutput.S)',
    );
  });

  it('CheckInvestorProfileSnapshotPresent Choice predicate checks Item.agentOutput.S', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const choice = branchStates.CheckInvestorProfileSnapshotPresent;
    expect(choice.Type).toBe('Choice');
    expect(choice.Choices[0].IsPresent).toBe(true);
    expect(choice.Choices[0].Variable).toBe(
      '$.investorProfileSnapshotResponse.Item.agentOutput.S',
    );
  });

  it('adds LookupMarketSnapshot — DDB GetItem on MarketSnapshot key, captures full response on $.marketSnapshotResponse (no ResultSelector — that would raise the uncatchable States.Runtime on absent rows)', () => {
    const branchStates = definition.States.ParallelProjections.Branches[1].States;
    const state = branchStates.LookupMarketSnapshot;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Task');
    // sfnTasks.DynamoGetItem renders Resource via { Fn::Sub } using the
    // aws-partition intrinsic, so the partition slot is a CFN ref token here.
    expect(state.Resource).toMatch(/states:::dynamodb:getItem$/);
    expect(state.Parameters.Key.pk['S.$']).toBe(
      "States.Format('MarketSnapshot#{}', $.region)",
    );
    expect(state.Parameters.Key.sk.S).toBe('MarketSnapshot');
    // No ResultSelector — evaluating States.StringToJson($.Item.agentOutput.S)
    // on a missing row raises States.Runtime, which AWS docs say is NOT catchable.
    // Defer the extraction to a downstream Pass guarded by a Choice on
    // isPresent($.marketSnapshotResponse.Item.agentOutput.S).
    expect(state.ResultSelector).toBeUndefined();
    expect(state.ResultPath).toBe('$.marketSnapshotResponse');
    expect(state.Next).toBe('CheckMarketSnapshotPresent');
  });

  it('Branch B fault-tolerance: Choice on $.marketSnapshotResponse.Item.agentOutput.S → ExtractMarketSnapshot or HandleMissingMarketSnapshot (both write empty-tolerant shape under $.agentResults.InvokeMarketIntelligence)', () => {
    const branchStates = definition.States.ParallelProjections.Branches[1].States;

    const choice = branchStates.CheckMarketSnapshotPresent;
    expect(choice).toBeDefined();
    expect(choice.Type).toBe('Choice');
    expect(choice.Choices).toHaveLength(1);
    expect(choice.Choices[0].Variable).toBe('$.marketSnapshotResponse.Item.agentOutput.S');
    expect(choice.Choices[0].IsPresent).toBe(true);
    expect(choice.Choices[0].Next).toBe('ExtractMarketSnapshot');
    expect(choice.Default).toBe('HandleMissingMarketSnapshot');

    const extract = branchStates.ExtractMarketSnapshot;
    expect(extract).toBeDefined();
    expect(extract.Type).toBe('Pass');
    expect(extract.Parameters['agentOutput.$']).toBe(
      'States.StringToJson($.marketSnapshotResponse.Item.agentOutput.S)',
    );
    expect(extract.ResultPath).toBe('$.agentResults.InvokeMarketIntelligence');
    expect(extract.End).toBe(true);

    const fallback = branchStates.HandleMissingMarketSnapshot;
    expect(fallback).toBeDefined();
    expect(fallback.Type).toBe('Pass');
    expect(fallback.Result).toEqual({ agentOutput: {} });
    expect(fallback.ResultPath).toBe('$.agentResults.InvokeMarketIntelligence');
    expect(fallback.End).toBe(true);
  });

  it('ExtractMarketSnapshot Pass parses agentOutput.S via States.StringToJson', () => {
    const branchStates = definition.States.ParallelProjections.Branches[1].States;
    const extract = branchStates.ExtractMarketSnapshot;
    expect(extract.Type).toBe('Pass');
    expect(extract.Parameters['agentOutput.$']).toBe(
      'States.StringToJson($.marketSnapshotResponse.Item.agentOutput.S)',
    );
  });

  it('CheckMarketSnapshotPresent Choice predicate checks Item.agentOutput.S', () => {
    const branchStates = definition.States.ParallelProjections.Branches[1].States;
    const choice = branchStates.CheckMarketSnapshotPresent;
    expect(choice.Type).toBe('Choice');
    expect(choice.Choices[0].IsPresent).toBe(true);
    expect(choice.Choices[0].Variable).toBe(
      '$.marketSnapshotResponse.Item.agentOutput.S',
    );
  });

  it('adds ParallelProjections — Parallel with three branches (IP Choice + Market lookup + Ledger lookup), resultPath $.parallelResults', () => {
    const state = definition.States.ParallelProjections;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Parallel');
    expect(state.ResultPath).toBe('$.parallelResults');
    expect(state.Branches).toHaveLength(3);
    // Branch 0 starts at the IP Choice.
    expect(state.Branches[0].StartAt).toBe('ResolveInvestorProfile');
    // Branch 1 starts at LookupMarketSnapshot.
    expect(state.Branches[1].StartAt).toBe('LookupMarketSnapshot');
    // Branch 2 starts at LookupLedgerSnapshot.
    expect(state.Branches[2].StartAt).toBe('LookupLedgerSnapshot');
  });

  it('adds MergeProjections — lifts both branches into top-level $.agentResults', () => {
    const state = definition.States.MergeProjections;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Pass');
    const agentResults = state.Parameters.agentResults;
    expect(agentResults.InvokeInvestorProfile['agentOutput.$']).toBe(
      '$.parallelResults[0].agentResults.InvokeInvestorProfile.agentOutput',
    );
    expect(agentResults.InvokeMarketIntelligence['agentOutput.$']).toBe(
      '$.parallelResults[1].agentResults.InvokeMarketIntelligence.agentOutput',
    );
    // triggerContext must still flow through so ResolveMandateSnapshot can read it.
    expect(state.Parameters['triggerContext.$']).toBe('$.triggerContext');
    // triggerAmountCentsContainer must flow through to AssembleDecisionPacket (regression: Task 4).
    expect(state.Parameters['triggerAmountCentsContainer.$']).toBe('$.triggerAmountCentsContainer');
  });

  // ---- ResolveMandateSnapshot Choice wrapping the existing mandate lookup -

  it('adds ResolveMandateSnapshot as a Choice wrapping LookupMandateSnapshot in the .otherwise() branch', () => {
    const state = definition.States.ResolveMandateSnapshot;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Choice');
    expect(state.Choices).toHaveLength(1);
    // Default falls through to the existing DDB lookup chain.
    expect(state.Default).toBe('LookupMandateSnapshot');
  });

  it('adds HoistMandateFromTrigger as a Pass that sets $.investorProfile.operatingMode from triggerContext', () => {
    const state = definition.States.HoistMandateFromTrigger;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Pass');
    expect(state.Parameters.investorProfile['operatingMode.$']).toBe(
      '$.triggerContext.operatingMode',
    );
    // Must preserve agentResults that ParallelProjections produced.
    expect(state.Parameters['agentResults.$']).toBe('$.agentResults');
    // triggerAmountCentsContainer must flow through to AssembleDecisionPacket (regression: Task 4).
    expect(state.Parameters['triggerAmountCentsContainer.$']).toBe('$.triggerAmountCentsContainer');
  });

  it('preserves LookupMandateSnapshot + SetInvestorProfile internals', () => {
    const lookup = definition.States.LookupMandateSnapshot;
    expect(lookup.Type).toBe('Task');
    expect(lookup.Resource).toBe('arn:aws:states:::dynamodb:getItem');
    expect(lookup.Parameters.Key.pk['S.$']).toBe(
      "States.Format('MandateSnapshot#{}#{}', $.tenantId, $.userId)",
    );
    expect(lookup.ResultSelector['operatingMode.$']).toBe('$.Item.operatingMode.S');

    const set = definition.States.SetInvestorProfile;
    expect(set.Type).toBe('Pass');
    expect(set.Parameters.investorProfile['operatingMode.$']).toBe(
      '$.mandateSnapshot.operatingMode',
    );
    // triggerAmountCentsContainer must flow through to AssembleDecisionPacket (regression: Task 4).
    expect(set.Parameters['triggerAmountCentsContainer.$']).toBe('$.triggerAmountCentsContainer');
  });

  // ---- PE + AN unchanged shape ------------------------------------------

  it('still invokes PortfolioEngine via putEvents.waitForTaskToken with the agentOutput plumbing', () => {
    const state = definition.States.InvokePortfolioEngine;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Task');
    expect(state.Resource).toBe('arn:aws:states:::events:putEvents.waitForTaskToken');
    const subject = state.Parameters.Entries[0].Detail.subject;
    expect(subject['investorProfile.$']).toBe('$.agentResults.InvokeInvestorProfile.agentOutput');
    expect(subject['marketAnalysis.$']).toBe('$.agentResults.InvokeMarketIntelligence.agentOutput');
  });

  it('still invokes AdvisoryNarrative via putEvents.waitForTaskToken with the agentOutput plumbing', () => {
    const state = definition.States.InvokeAdvisoryNarrative;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Task');
    expect(state.Resource).toBe('arn:aws:states:::events:putEvents.waitForTaskToken');
    const subject = state.Parameters.Entries[0].Detail.subject;
    expect(subject['investorProfile.$']).toBe('$.agentResults.InvokeInvestorProfile.agentOutput');
    expect(subject['marketAnalysis.$']).toBe('$.agentResults.InvokeMarketIntelligence.agentOutput');
    expect(subject['portfolio.$']).toBe('$.agentResults.InvokePortfolioEngine.agentOutput');
  });

  it('sets TimeoutSeconds on InvokePortfolioEngine to AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC', () => {
    const state = definition.States.InvokePortfolioEngine;
    expect(state.TimeoutSeconds).toBe(120);
  });

  it('sets TimeoutSeconds on InvokeAdvisoryNarrative to AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC', () => {
    const state = definition.States.InvokeAdvisoryNarrative;
    expect(state.TimeoutSeconds).toBe(120);
  });

  it('PE + AN read operatingMode from $.investorProfile.operatingMode (post-ResolveMandateSnapshot)', () => {
    // After ResolveMandateSnapshot, operatingMode lives at $.investorProfile.operatingMode
    // (either hoisted from triggerContext or set by SetInvestorProfile via mandateSnapshot).
    // The old SF read it from $.agentResults.InvokeInvestorProfile.operatingMode — the IP
    // agent is no longer in the cycle, so that path is dead.
    const peSubject = definition.States.InvokePortfolioEngine.Parameters.Entries[0].Detail.subject;
    const anSubject = definition.States.InvokeAdvisoryNarrative.Parameters.Entries[0].Detail.subject;
    expect(peSubject['operatingMode.$']).toBe('$.investorProfile.operatingMode');
    expect(anSubject['operatingMode.$']).toBe('$.investorProfile.operatingMode');
  });

  // ---- Main chain ordering ----------------------------------------------

  it('wires the main chain UnpackTriggerEnvelope → EmitDecisionCycleStarted → ResolveTriggerAmountCents → ParallelProjections → MergeProjections → ResolveMandateSnapshot', () => {
    expect(definition.States.UnpackTriggerEnvelope.Next).toBe('EmitDecisionCycleStarted');
    expect(definition.States.EmitDecisionCycleStarted.Next).toBe('ResolveTriggerAmountCents');
    // Both ResolveTriggerAmountCents branches converge on ParallelProjections.
    expect(definition.States.SetTriggerAmountCentsFromTrigger.Next).toBe('ParallelProjections');
    expect(definition.States.SetTriggerAmountCentsZero.Next).toBe('ParallelProjections');
    expect(definition.States.ParallelProjections.Next).toBe('MergeProjections');
    expect(definition.States.MergeProjections.Next).toBe('ResolveMandateSnapshot');
    // The Choice's default branch eventually feeds into InvokePortfolioEngine via SetInvestorProfile.
    expect(definition.States.SetInvestorProfile.Next).toBe('InvokePortfolioEngine');
    // The hoist branch must also feed into InvokePortfolioEngine.
    expect(definition.States.HoistMandateFromTrigger.Next).toBe('InvokePortfolioEngine');
  });

  // ---- WS-1: cycle-lifecycle events (advisory-generating-failed-ux) ---------

  it('emits DECISION_CYCLE_STARTED as a fire-and-forget putEvents (GENERATING, __version 0, ResultPath DISCARD)', () => {
    const s = definition.States.EmitDecisionCycleStarted;
    expect(s).toBeDefined();
    expect(s.Type).toBe('Task');
    // fire-and-forget — NOT putEvents.waitForTaskToken
    expect(s.Resource).toBe('arn:aws:states:::events:putEvents');
    // DISCARD so decisionId/tenantId/userId/region flow through to ResolveTriggerAmountCents
    expect(s.ResultPath).toBeNull();
    const entry = s.Parameters.Entries[0];
    expect(entry.DetailType).toBe('DECISION_CYCLE_STARTED');
    expect(entry.Source).toBeDefined();
    const detail = entry.Detail;
    expect(detail.type).toBe('DECISION_CYCLE_STARTED');
    expect(detail.subject['decisionId.$']).toBe('$.decisionId');
    expect(detail.subject['tenantId.$']).toBe('$.tenantId');
    expect(detail.subject.status).toBe('GENERATING');
    expect(detail.subject.__version).toBe(0);
    expect(detail.context['tenantId.$']).toBe('$.tenantId');
    expect(detail.context['userId.$']).toBe('$.userId');
    expect(detail.context['region.$']).toBe('$.region');
  });

  it('splices EmitDecisionCycleStarted between UnpackTriggerEnvelope and ResolveTriggerAmountCents', () => {
    expect(definition.States.UnpackTriggerEnvelope.Next).toBe('EmitDecisionCycleStarted');
    expect(definition.States.EmitDecisionCycleStarted.Next).toBe('ResolveTriggerAmountCents');
  });

  it('compliance choice + downstream states preserved', () => {
    expect(definition.States.ComplianceChoice).toBeDefined();
    expect(definition.States.ComplianceChoice.Type).toBe('Choice');
    expect(definition.States.WaitForCompliance).toBeDefined();
    expect(definition.States.AssembleDecisionPacket).toBeDefined();
    expect(definition.States.RequestUserConfirmation).toBeDefined();
  });

  // ---- Workstream 3 (Task 1.3): RequestUserConfirmation writes the L2 token --
  // The fragment USER_CONFIRMATION_REQUESTED event is eliminated. Instead the SF
  // writes the user-confirmation task token directly onto the DecisionPacket row
  // via aws-sdk:dynamodb:updateItem.waitForTaskToken — in one atomic write that
  // also sets status=AWAITING_CONFIRMATION and bumps __version. The token rides
  // the versioned CDC snapshot (DECISION_PACKET_UPDATED) to advisory-bff.

  it('RequestUserConfirmation writes token + AWAITING + version via aws-sdk:dynamodb:updateItem.waitForTaskToken', () => {
    const state = definition.States['RequestUserConfirmation'];
    expect(state.Resource).toBe('arn:aws:states:::aws-sdk:dynamodb:updateItem.waitForTaskToken');
    expect(state.Parameters.UpdateExpression).toContain('ADD #v :one');
    expect(state.Parameters.UpdateExpression).toContain('SET #s = :awaiting');
    expect(state.Parameters.UpdateExpression).toContain('taskToken = :tok');
    expect(state.Parameters.ExpressionAttributeValues[':tok']['S.$']).toBe('$$.Task.Token');
  });

  it('RequestUserConfirmation keys the DecisionPacket row + sets AWAITING_CONFIRMATION + keeps the 72h timeout + $.userResponse ResultPath', () => {
    const state = definition.States['RequestUserConfirmation'];
    expect(state.Type).toBe('Task');
    expect(state.Parameters.Key.pk['S.$']).toBe(
      "States.Format('DecisionPacket#{}#{}', $.tenantId, $.decisionId)",
    );
    expect(state.Parameters.Key.sk.S).toBe('DecisionPacket');
    expect(state.Parameters.ExpressionAttributeNames['#v']).toBe('__version');
    expect(state.Parameters.ExpressionAttributeNames['#s']).toBe('status');
    expect(state.Parameters.ExpressionAttributeValues[':awaiting'].S).toBe('AWAITING_CONFIRMATION');
    expect(state.Parameters.ExpressionAttributeValues[':one'].N).toBe('1');
    expect(state.Parameters.ExpressionAttributeValues[':now']['S.$']).toBe('$$.State.EnteredTime');
    expect(state.TimeoutSeconds).toBe(72 * 60 * 60);
    expect(state.ResultPath).toBe('$.userResponse');
  });

  it('RequestUserConfirmation no longer emits USER_CONFIRMATION_REQUESTED via putEvents.waitForTaskToken (fragment event eliminated)', () => {
    const state = definition.States['RequestUserConfirmation'];
    expect(state.Resource).not.toBe('arn:aws:states:::events:putEvents.waitForTaskToken');
    expect(state.Parameters.Entries).toBeUndefined();
  });

  // ---- decision-pipeline-units-calibration-suitability workstream ----------

  it('UnpackTriggerEnvelope does NOT include triggerAmountCents (resolved by ResolveTriggerAmountCents Choice)', () => {
    const s = definition.States.UnpackTriggerEnvelope;
    expect(s.Parameters['triggerAmountCents.$']).toBeUndefined();
  });

  it('ResolveTriggerAmountCents is a Choice on isPresent($.triggerContext.amountCents)', () => {
    const s = definition.States.ResolveTriggerAmountCents;
    expect(s).toBeDefined();
    expect(s.Type).toBe('Choice');
    expect(s.Choices).toHaveLength(1);
    expect(s.Choices[0].Variable).toBe('$.triggerContext.amountCents');
    expect(s.Choices[0].IsPresent).toBe(true);
    expect(s.Choices[0].Next).toBe('SetTriggerAmountCentsFromTrigger');
    expect(s.Default).toBe('SetTriggerAmountCentsZero');
  });

  it('SetTriggerAmountCentsFromTrigger Pass projects $.triggerContext.amountCents into $.triggerAmountCentsContainer.value', () => {
    const s = definition.States.SetTriggerAmountCentsFromTrigger;
    expect(s).toBeDefined();
    expect(s.Type).toBe('Pass');
    expect(s.Parameters['value.$']).toBe('$.triggerContext.amountCents');
    expect(s.ResultPath).toBe('$.triggerAmountCentsContainer');
  });

  it('SetTriggerAmountCentsZero Pass injects { value: 0 } into $.triggerAmountCentsContainer', () => {
    const s = definition.States.SetTriggerAmountCentsZero;
    expect(s).toBeDefined();
    expect(s.Type).toBe('Pass');
    expect(s.Result).toEqual({ value: 0 });
    expect(s.ResultPath).toBe('$.triggerAmountCentsContainer');
  });

  it('both ResolveTriggerAmountCents branches converge on ParallelProjections', () => {
    expect(definition.States.SetTriggerAmountCentsFromTrigger.Next).toBe('ParallelProjections');
    expect(definition.States.SetTriggerAmountCentsZero.Next).toBe('ParallelProjections');
  });

  it('AssembleDecisionPacket payload reads triggerAmountCents from $.triggerAmountCentsContainer.value', () => {
    const s = definition.States.AssembleDecisionPacket;
    expect(s.Parameters.Payload['triggerAmountCents.$']).toBe('$.triggerAmountCentsContainer.value');
  });

  it('AssembleDecisionPacket ResultSelector projects portfolioValueCents + isInitialBuild + riskCategory', () => {
    const s = definition.States.AssembleDecisionPacket;
    expect(s.ResultSelector['portfolioValueCents.$']).toBe('$.Payload.portfolioValueCents');
    expect(s.ResultSelector['isInitialBuild.$']).toBe('$.Payload.isInitialBuild');
    expect(s.ResultSelector['riskCategory.$']).toBe('$.Payload.riskCategory');
    expect(s.ResultSelector).not.toHaveProperty('portfolioValue.$');
    expect(s.ResultSelector).not.toHaveProperty('riskScore.$');
  });

  it('WaitForCompliance subject carries portfolioValueCents, isInitialBuild, riskCategory (not portfolioValue/riskScore)', () => {
    const s = definition.States.WaitForCompliance;
    const subject = s.Parameters.Entries[0].Detail.subject;
    expect(subject['portfolioValueCents.$']).toBe('$.decisionPacket.portfolioValueCents');
    expect(subject['isInitialBuild.$']).toBe('$.decisionPacket.isInitialBuild');
    expect(subject['riskCategory.$']).toBe('$.decisionPacket.riskCategory');
    expect(subject).not.toHaveProperty('portfolioValue.$');
    expect(subject).not.toHaveProperty('riskScore.$');
  });

  it('HoistInvestorProfileFromTrigger seeds riskCategory from trigger riskProfile.category', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const s = branchStates.HoistInvestorProfileFromTrigger;
    expect(s.Parameters.agentOutput['riskCategory.$']).toBe('$.triggerContext.riskProfile.category');
  });

  // ---- Task 5: ledgerSnapshot lift + pass-through ---------------------------

  it('MergeProjections lifts $.parallelResults[2].ledgerSnapshot.state to $.ledgerSnapshot', () => {
    expect(definition.States.MergeProjections.Parameters['ledgerSnapshot.$']).toBe(
      '$.parallelResults[2].ledgerSnapshot.state',
    );
  });

  it('SetInvestorProfile forwards ledgerSnapshot through', () => {
    expect(definition.States.SetInvestorProfile.Parameters['ledgerSnapshot.$']).toBe('$.ledgerSnapshot');
  });

  it('HoistMandateFromTrigger forwards ledgerSnapshot through', () => {
    expect(definition.States.HoistMandateFromTrigger.Parameters['ledgerSnapshot.$']).toBe('$.ledgerSnapshot');
  });

  // ---- Branch C: LookupLedgerSnapshot ---------------------------------------

  it('ParallelProjections includes a LookupLedgerSnapshot branch (Branch C) with Choice on isPresent($.ledgerSnapshotResponse.Item.state.S)', () => {
    const parallelState = definition.States.ParallelProjections;
    expect(parallelState.Branches).toHaveLength(3);

    const branchStates = parallelState.Branches[2].States;

    // LookupLedgerSnapshot — DDB GetItem
    const lookup = branchStates.LookupLedgerSnapshot;
    expect(lookup).toBeDefined();
    expect(lookup.Type).toBe('Task');
    expect(lookup.Resource).toMatch(/states:::dynamodb:getItem$/);
    expect(lookup.Parameters.Key.pk['S.$']).toBe(
      "States.Format('LedgerSnapshot#{}', $.tenantId)",
    );
    expect(lookup.Parameters.Key.sk.S).toBe('LedgerSnapshot');
    expect(lookup.ResultSelector).toBeUndefined();
    expect(lookup.ResultPath).toBe('$.ledgerSnapshotResponse');
    expect(lookup.Next).toBe('CheckLedgerSnapshotPresent');

    // CheckLedgerSnapshotPresent — Choice on isPresent
    const choice = branchStates.CheckLedgerSnapshotPresent;
    expect(choice).toBeDefined();
    expect(choice.Type).toBe('Choice');
    expect(choice.Choices).toHaveLength(1);
    expect(choice.Choices[0].Variable).toBe('$.ledgerSnapshotResponse.Item.state.S');
    expect(choice.Choices[0].IsPresent).toBe(true);
    expect(choice.Choices[0].Next).toBe('ExtractLedgerSnapshot');
    expect(choice.Default).toBe('HandleMissingLedgerSnapshot');

    // ExtractLedgerSnapshot — Pass that parses JSON string
    const extract = branchStates.ExtractLedgerSnapshot;
    expect(extract).toBeDefined();
    expect(extract.Type).toBe('Pass');
    expect(extract.Parameters['state.$']).toMatch(/States\.StringToJson/);
    expect(extract.ResultPath).toBe('$.ledgerSnapshot');
    expect(extract.End).toBe(true);

    // HandleMissingLedgerSnapshot — Pass that seeds defaults
    const fallback = branchStates.HandleMissingLedgerSnapshot;
    expect(fallback).toBeDefined();
    expect(fallback.Type).toBe('Pass');
    expect(fallback.Result).toEqual({ state: { positions: {}, cashBalanceCents: 0 } });
    expect(fallback.ResultPath).toBe('$.ledgerSnapshot');
    expect(fallback.End).toBe(true);
  });

  // ---- Task 6: AssembleDecisionPacket Payload carries ledgerSnapshot --------

  it('AssembleDecisionPacket Payload includes ledgerSnapshot', () => {
    expect(definition.States.AssembleDecisionPacket.Parameters.Payload['ledgerSnapshot.$']).toBe(
      '$.ledgerSnapshot',
    );
  });

  it('AssembleDecisionPacket ResultSelector still flattens proposedTrades + currentPositions', () => {
    expect(definition.States.AssembleDecisionPacket.ResultSelector['proposedTrades.$']).toBe('$.Payload.proposedTrades');
    expect(definition.States.AssembleDecisionPacket.ResultSelector['currentPositions.$']).toBe('$.Payload.currentPositions');
  });
});
