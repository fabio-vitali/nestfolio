import { dispatchAgentInvocation } from '../src/dispatch-runtime';

jest.mock('../src/invoke-agentcore', () => ({
  invokeAgentCoreRuntime: jest.fn(),
}));
jest.mock('../src/invoke-mock', () => ({
  invokeMockRuntime: jest.fn(),
}));

import { invokeAgentCoreRuntime } from '../src/invoke-agentcore';
import { invokeMockRuntime } from '../src/invoke-mock';

describe('dispatchAgentInvocation', () => {
  const payload = { tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} };

  beforeEach(() => {
    (invokeAgentCoreRuntime as jest.Mock).mockReset();
    (invokeMockRuntime as jest.Mock).mockReset();
  });

  it('routes arn: targets to invokeAgentCoreRuntime', async () => {
    (invokeAgentCoreRuntime as jest.Mock).mockResolvedValue({ via: 'agentcore' });
    const result = await dispatchAgentInvocation(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo',
      payload,
    );
    expect(result).toEqual({ via: 'agentcore' });
    expect(invokeAgentCoreRuntime).toHaveBeenCalledTimes(1);
    expect(invokeMockRuntime).not.toHaveBeenCalled();
  });

  it('routes https:// targets to invokeMockRuntime', async () => {
    (invokeMockRuntime as jest.Mock).mockResolvedValue({ via: 'mock' });
    const result = await dispatchAgentInvocation('https://mock.example.com', payload);
    expect(result).toEqual({ via: 'mock' });
    expect(invokeMockRuntime).toHaveBeenCalledTimes(1);
    expect(invokeAgentCoreRuntime).not.toHaveBeenCalled();
  });

  it('throws on unrecognized targets', async () => {
    await expect(dispatchAgentInvocation('DISABLED', payload)).rejects.toThrow(
      'Unrecognized agent runtime target: DISABLED',
    );
    await expect(dispatchAgentInvocation('http://insecure.example.com', payload))
      .rejects.toThrow('Unrecognized agent runtime target: http://insecure.example.com');
  });
});
