import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AdvisoryBffStack } from '../../src/service.stack';

describe('AdvisoryBffStack', () => {
  const synth = (): Template => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new AdvisoryBffStack(app, 'TestAdvisoryBffStack', {
      prefix: 'test',
      service: 'advisory-bff',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    return Template.fromStack(stack);
  };

  it('creates a DynamoDB table', () => {
    synth().resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('adds the AdvisoryStatusProjector as a third DynamoDB-stream consumer', () => {
    const t = synth();
    // The table stream feeds three Lambdas: the Egress CDC publisher, the
    // DecisionPublisher broadcaster, and (new in w3) the AdvisoryStatus projector
    // (P3 recompute). The Ingress SQS mapping is NOT a stream mapping. Filter on
    // the EventSourceArn pointing at the table's StreamArn.
    const mappings = t.findResources('AWS::Lambda::EventSourceMapping');
    const streamMappings = Object.entries(mappings).filter(([, m]) => {
      const arn = (m.Properties as { EventSourceArn?: { 'Fn::GetAtt'?: string[] } })
        ?.EventSourceArn;
      const getAtt = arn?.['Fn::GetAtt'];
      return Array.isArray(getAtt) && getAtt[getAtt.length - 1] === 'StreamArn';
    });
    expect(streamMappings.length).toBe(3);
    expect(streamMappings.some(([id]) => id.startsWith('AdvisoryStatusProjector'))).toBe(true);
  });

  it('Ingress subscribes to ONLY the two DecisionPacket snapshot events', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': ['DECISION_PACKET_CREATED', 'DECISION_PACKET_UPDATED'],
      },
    });
  });

  it('Ingress no longer subscribes to status / trigger events (races removed)', () => {
    const t = synth();
    const rules = t.findResources('AWS::Events::Rule');
    const detailTypes = Object.values(rules).flatMap((r) => {
      const dt = (r.Properties as { EventPattern?: { 'detail-type'?: string[] } })
        ?.EventPattern?.['detail-type'];
      return Array.isArray(dt) ? dt : [];
    });
    for (const removed of [
      'DECISION_APPROVED',
      'DECISION_BLOCKED',
      'USER_CONFIRMATION_REQUESTED',
      'MANDATE_SNAPSHOT_CREATED',
      'PORTFOLIO_DRIFT_DETECTED',
      'ORDER_FILLED',
    ]) {
      expect(detailTypes).not.toContain(removed);
    }
  });
});
