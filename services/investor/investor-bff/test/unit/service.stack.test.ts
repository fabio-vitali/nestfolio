import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InvestorBffStack } from '../../src/service.stack';

describe('InvestorBffStack', () => {
  const synth = (): Template => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new InvestorBffStack(app, 'TestInvestorBffStack', {
      prefix: 'test',
      service: 'investor-bff',
      subsystem: 'investor',
    });
    return Template.fromStack(stack);
  };

  // Stream consumers = EventSourceMappings whose EventSourceArn points at the
  // table StreamArn (the two Ingress SQS mappings are NOT stream mappings).
  const streamMappings = (t: Template): [string, { Properties: Record<string, unknown> }][] => {
    const mappings = t.findResources('AWS::Lambda::EventSourceMapping');
    return Object.entries(mappings).filter(([, m]) => {
      const arn = (m.Properties as { EventSourceArn?: { 'Fn::GetAtt'?: string[] } })?.EventSourceArn;
      const getAtt = arn?.['Fn::GetAtt'];
      return Array.isArray(getAtt) && getAtt[getAtt.length - 1] === 'StreamArn';
    }) as [string, { Properties: Record<string, unknown> }][];
  };

  it('wires two DDB-stream consumers — Egress CDC + DepositBroadcaster', () => {
    const sm = streamMappings(synth());
    expect(sm.length).toBe(2);
    expect(sm.some(([id]) => id.startsWith('DepositBroadcaster'))).toBe(true);
  });

  it('every DDB-stream consumer has a DLQ + bisectBatchOnError (no poison-pill drop)', () => {
    const sm = streamMappings(synth());
    expect(sm.length).toBeGreaterThan(0);
    for (const [, mapping] of sm) {
      const props = mapping.Properties as {
        BisectBatchOnFunctionError?: boolean;
        DestinationConfig?: { OnFailure?: { Destination?: unknown } };
      };
      expect(props.BisectBatchOnFunctionError).toBe(true);
      expect(props.DestinationConfig?.OnFailure?.Destination).toBeDefined();
    }
  });
});
