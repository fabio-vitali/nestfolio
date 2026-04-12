const mockFetch = jest.fn() as jest.Mock & typeof fetch;
global.fetch = mockFetch;

jest.mock('@aws-sdk/client-ssm', () => {
  const send = jest.fn();
  return {
    SSMClient: jest.fn().mockImplementation(() => ({ send, destroy: jest.fn() })),
    GetParameterCommand: jest.fn().mockImplementation((args) => ({ __cmd: 'GetParameter', ...args })),
    __mockSend: send,
  };
});

jest.mock('@aws-sdk/client-secrets-manager', () => {
  const send = jest.fn();
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({ send, destroy: jest.fn() })),
    GetSecretValueCommand: jest.fn().mockImplementation((args) => ({ __cmd: 'GetSecretValue', ...args })),
    __mockSend: send,
  };
});

import { alpacaPaperReset } from '../../src/helpers/alpaca-paper-reset';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ssmMod = require('@aws-sdk/client-ssm');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const smMod = require('@aws-sdk/client-secrets-manager');

describe('alpacaPaperReset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to run if the resolved baseUrl is not in the paper allowlist', async () => {
    ssmMod.__mockSend.mockResolvedValueOnce({ Parameter: { Value: 'https://api.alpaca.markets' } });
    smMod.__mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ apiKeyId: 'k', apiKeySecret: 's' }) });

    await expect(alpacaPaperReset('dev')).rejects.toThrow(/not in the paper allowlist/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('issues DELETE /v2/orders and DELETE /v2/positions when baseUrl is paper', async () => {
    ssmMod.__mockSend.mockResolvedValueOnce({ Parameter: { Value: 'https://paper-api.alpaca.markets' } });
    smMod.__mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ apiKeyId: 'k', apiKeySecret: 's' }) });
    mockFetch.mockResolvedValue({ status: 207, json: async () => [] } as any);

    await alpacaPaperReset('dev');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/orders',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/positions?cancel_orders=true',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
