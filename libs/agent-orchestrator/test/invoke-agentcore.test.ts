import { mockClient } from 'aws-sdk-client-mock';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { Readable } from 'stream';
import { sdkStreamMixin } from '@smithy/util-stream';
import { invokeAgentCoreRuntime } from '../src/invoke-agentcore';

describe('invokeAgentCoreRuntime', () => {
  const sdk = mockClient(BedrockAgentCoreClient);

  beforeEach(() => sdk.reset());

  it('invokes InvokeAgentRuntimeCommand with the structured envelope as a UTF-8 payload', async () => {
    const stream = sdkStreamMixin(Readable.from([Buffer.from(JSON.stringify({ ok: true }))]));
    sdk.on(InvokeAgentRuntimeCommand).resolves({ response: stream } as never);

    const result = await invokeAgentCoreRuntime<{ ok: boolean }>(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo',
      { tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } },
    );

    expect(result).toEqual({ ok: true });
    const call = sdk.commandCalls(InvokeAgentRuntimeCommand)[0];
    expect(call.args[0].input.agentRuntimeArn).toBe(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo',
    );
    expect(call.args[0].input.runtimeSessionId).toBe('t1/d1');
    const sent = JSON.parse(new TextDecoder().decode(call.args[0].input.payload as Uint8Array));
    expect(sent).toEqual({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } });
  });

  it('throws when the runtime returns no response stream', async () => {
    sdk.on(InvokeAgentRuntimeCommand).resolves({} as never);
    await expect(
      invokeAgentCoreRuntime('arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo', {
        tenantId: 't1', decisionId: 'd1', upstreamOutputs: {},
      }),
    ).rejects.toThrow('AgentCore runtime returned no response body');
  });
});
