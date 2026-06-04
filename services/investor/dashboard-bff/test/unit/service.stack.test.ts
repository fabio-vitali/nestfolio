import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DashboardBffStack } from '../../src/service.stack';

describe('DashboardBffStack', () => {
  const synth = (): Template => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new DashboardBffStack(app, 'TestDashboardBffStack', {
      prefix: 'test',
      service: 'dashboard-bff',
      subsystem: 'investor',
    });
    return Template.fromStack(stack);
  };

  // Stream consumers = EventSourceMappings whose EventSourceArn points at the
  // table StreamArn (the Ingress SQS mapping is NOT a stream mapping).
  const streamMappings = (t: Template): [string, { Properties: Record<string, unknown> }][] => {
    const mappings = t.findResources('AWS::Lambda::EventSourceMapping');
    return Object.entries(mappings).filter(([, m]) => {
      const arn = (m.Properties as { EventSourceArn?: { 'Fn::GetAtt'?: string[] } })?.EventSourceArn;
      const getAtt = arn?.['Fn::GetAtt'];
      return Array.isArray(getAtt) && getAtt[getAtt.length - 1] === 'StreamArn';
    }) as [string, { Properties: Record<string, unknown> }][];
  };

  it('wires exactly one DDB-stream consumer — the DashboardBroadcaster', () => {
    const sm = streamMappings(synth());
    expect(sm.length).toBe(1);
    expect(sm[0][0]).toMatch(/^DashboardBroadcaster/);
  });

  it('the broadcaster stream consumer has a DLQ + bisectBatchOnError (no poison-pill drop)', () => {
    const props = streamMappings(synth())[0][1].Properties as {
      BisectBatchOnFunctionError?: boolean;
      DestinationConfig?: { OnFailure?: { Destination?: unknown } };
    };
    expect(props.BisectBatchOnFunctionError).toBe(true);
    expect(props.DestinationConfig?.OnFailure?.Destination).toBeDefined();
  });

  it('provisions a DLQ with 14-day retention', () => {
    synth().hasResourceProperties('AWS::SQS::Queue', { MessageRetentionPeriod: 1209600 });
  });
});
