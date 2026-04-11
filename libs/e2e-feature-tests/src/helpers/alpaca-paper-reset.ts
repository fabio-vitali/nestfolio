import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const PAPER_ALLOWLIST = new Set(['https://paper-api.alpaca.markets']);

export interface AlpacaResetOptions {
  region?: string;
}

/**
 * Jest globalTeardown helper: wipes open orders + positions in the paper
 * Alpaca account for the given prefix. Refuses to touch anything outside
 * the paper allowlist. Reuses the adapter's own SSM param + secret names.
 */
export async function alpacaPaperReset(
  prefix: string,
  opts: AlpacaResetOptions = {},
): Promise<void> {
  const region = opts.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const ssm = new SSMClient({ region });
  const sm = new SecretsManagerClient({ region });

  try {
    const paramName = `/nestfolio/${prefix}-broker-alpaca-adpt/alpaca/baseUrl`;
    const secretId = `${prefix}-broker-alpaca-adpt/alpaca-api-keys`;

    const paramRes = await ssm.send(new GetParameterCommand({ Name: paramName }));
    const baseUrl = paramRes.Parameter?.Value;
    if (!baseUrl) throw new Error(`alpacaPaperReset: SSM parameter ${paramName} not found`);

    if (!PAPER_ALLOWLIST.has(baseUrl)) {
      throw new Error(
        `alpacaPaperReset: refusing to run — resolved baseUrl '${baseUrl}' is not in the paper allowlist.`,
      );
    }

    const secretRes = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!secretRes.SecretString) throw new Error(`alpacaPaperReset: secret ${secretId} empty`);
    const keys = JSON.parse(secretRes.SecretString) as { apiKeyId: string; apiKeySecret: string };

    const headers = {
      'APCA-API-KEY-ID': keys.apiKeyId,
      'APCA-API-SECRET-KEY': keys.apiKeySecret,
      'Content-Type': 'application/json',
    };

    await fetch(`${baseUrl}/v2/orders`, { method: 'DELETE', headers });
    await fetch(`${baseUrl}/v2/positions?cancel_orders=true`, { method: 'DELETE', headers });
  } finally {
    ssm.destroy();
    sm.destroy();
  }
}
