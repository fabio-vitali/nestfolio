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

  it('adds LookupInvestorProfileSnapshot — DDB GetItem on InvestorProfileSnapshot key, ResultPath under agentResults.InvokeInvestorProfile', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const state = branchStates.LookupInvestorProfileSnapshot;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Task');
    expect(state.Resource).toBe('arn:aws:states:::dynamodb:getItem');
    expect(state.Parameters.Key.pk['S.$']).toBe(
      "States.Format('InvestorProfileSnapshot#{}#{}', $.tenantId, $.userId)",
    );
    expect(state.Parameters.Key.sk.S).toBe('InvestorProfileSnapshot');
    expect(state.ResultSelector['agentOutput.$']).toBe('$.Item.agentOutput.M');
    expect(state.ResultPath).toBe('$.agentResults.InvokeInvestorProfile');
  });

  it('adds LookupMarketSnapshot — DDB GetItem on MarketSnapshot key, ResultPath under agentResults.InvokeMarketIntelligence', () => {
    const branchStates = definition.States.ParallelProjections.Branches[1].States;
    const state = branchStates.LookupMarketSnapshot;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Task');
    expect(state.Resource).toBe('arn:aws:states:::dynamodb:getItem');
    expect(state.Parameters.Key.pk['S.$']).toBe(
      "States.Format('MarketSnapshot#{}', $.region)",
    );
    expect(state.Parameters.Key.sk.S).toBe('MarketSnapshot');
    expect(state.ResultSelector['agentOutput.$']).toBe('$.Item.agentOutput.M');
    expect(state.ResultPath).toBe('$.agentResults.InvokeMarketIntelligence');
  });

  it('LookupMarketSnapshot Catch routes missing-row / task-failed errors to HandleMissingMarketSnapshot with an empty agentOutput default', () => {
    const branchStates = definition.States.ParallelProjections.Branches[1].States;
    const lookup = branchStates.LookupMarketSnapshot;
    expect(Array.isArray(lookup.Catch)).toBe(true);
    expect(lookup.Catch.length).toBeGreaterThanOrEqual(1);

    const catchClause = lookup.Catch[0];
    expect(catchClause.ErrorEquals).toEqual(
      expect.arrayContaining(['States.Runtime', 'States.TaskFailed']),
    );
    expect(catchClause.Next).toBe('HandleMissingMarketSnapshot');
    // ResultPath: null discards the error payload so the Pass starts from the
    // original SF input (decisionId, tenantId, region, etc. preserved).
    expect(catchClause.ResultPath).toBeNull();

    const fallback = branchStates.HandleMissingMarketSnapshot;
    expect(fallback).toBeDefined();
    expect(fallback.Type).toBe('Pass');
    expect(fallback.Result).toEqual({ agentOutput: {} });
    expect(fallback.ResultPath).toBe('$.agentResults.InvokeMarketIntelligence');
    // Terminal in the Parallel branch — MergeProjections runs at the outer
    // scope after the Parallel completes.
    expect(fallback.End).toBe(true);
  });

  it('adds ParallelProjections — Parallel with two branches (IP Choice + Market lookup), resultPath $.parallelResults', () => {
    const state = definition.States.ParallelProjections;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Parallel');
    expect(state.ResultPath).toBe('$.parallelResults');
    expect(state.Branches).toHaveLength(2);
    // Branch 0 starts at the IP Choice.
    expect(state.Branches[0].StartAt).toBe('ResolveInvestorProfile');
    // Branch 1 starts at LookupMarketSnapshot.
    expect(state.Branches[1].StartAt).toBe('LookupMarketSnapshot');
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

  it('wires the main chain UnpackTriggerEnvelope → ParallelProjections → MergeProjections → ResolveMandateSnapshot', () => {
    expect(definition.States.UnpackTriggerEnvelope.Next).toBe('ParallelProjections');
    expect(definition.States.ParallelProjections.Next).toBe('MergeProjections');
    expect(definition.States.MergeProjections.Next).toBe('ResolveMandateSnapshot');
    // The Choice's default branch eventually feeds into InvokePortfolioEngine via SetInvestorProfile.
    expect(definition.States.SetInvestorProfile.Next).toBe('InvokePortfolioEngine');
    // The hoist branch must also feed into InvokePortfolioEngine.
    expect(definition.States.HoistMandateFromTrigger.Next).toBe('InvokePortfolioEngine');
  });

  it('compliance choice + downstream states preserved', () => {
    expect(definition.States.ComplianceChoice).toBeDefined();
    expect(definition.States.ComplianceChoice.Type).toBe('Choice');
    expect(definition.States.WaitForCompliance).toBeDefined();
    expect(definition.States.AssembleDecisionPacket).toBeDefined();
    expect(definition.States.RequestUserConfirmation).toBeDefined();
  });
});
