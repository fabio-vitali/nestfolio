import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { join } from 'node:path';
import { ApolloClient, InMemoryCache, gql, HttpLink, from } from '@apollo/client/core';
import { createAuthLink, AUTH_TYPE } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import fetch from 'cross-fetch';
import { ensureTestUser } from './ensure-test-user';
import { getCognitoIdToken } from './cognito-auth';

dotenvConfig({ path: join(__dirname, '..', '.env.local') });

const requireEnv = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};

async function main(): Promise<void> {
  const region = requireEnv('AWS_REGION');
  const userPoolId = requireEnv('COGNITO_USER_POOL_ID');
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  const username = requireEnv('SPIKE_TEST_USERNAME');
  const password = requireEnv('SPIKE_TEST_PASSWORD');
  const tenantId = requireEnv('SPIKE_TEST_TENANT_ID');
  const cfDomain = requireEnv('SPIKE_CF_DOMAIN');
  const directHttps = requireEnv('APPSYNC_HTTPS_URL');

  console.log('[spike] Ensuring test user exists');
  await ensureTestUser({ region, userPoolId, username, password, tenantId });

  console.log('[spike] Acquiring Cognito ID token');
  const idToken = await getCognitoIdToken({ region, clientId, username, password });

  // CF-proxied URL for subscriptions; direct AppSync HTTPS for the trigger mutation.
  // Mutation is sent direct because R6 CloudFront proxying for GraphQL HTTP is
  // a separate concern; this spike only verifies WSS-through-CF.
  const cfGraphqlUrl = `https://${cfDomain}/realtime/investor`;

  const auth = {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    jwtToken: idToken,
  } as const;

  const subClient = new ApolloClient({
    link: from([
      createAuthLink({ url: cfGraphqlUrl, region, auth }),
      createSubscriptionHandshakeLink({ url: cfGraphqlUrl, region, auth }, new HttpLink({ uri: cfGraphqlUrl, fetch })),
    ]),
    cache: new InMemoryCache(),
  });

  const triggerClient = new ApolloClient({
    link: from([
      createAuthLink({ url: directHttps, region, auth }),
      new HttpLink({ uri: directHttps, fetch }),
    ]),
    cache: new InMemoryCache(),
  });

  console.log('[spike] Opening subscription via', cfGraphqlUrl);

  const received: unknown[] = [];
  const sub = subClient
    .subscribe({
      query: gql`
        subscription OnNotification {
          onNotification {
            notificationId
            readAt
          }
        }
      `,
    })
    .subscribe({
      next: (payload) => {
        console.log('[spike] subscription payload received:', JSON.stringify(payload.data));
        received.push(payload.data);
      },
      error: (err) => {
        console.error('[spike] subscription error:', err);
      },
    });

  // Give the WS time to handshake before triggering.
  await new Promise((r) => setTimeout(r, 5000));

  console.log('[spike] Triggering markNotificationRead mutation (direct AppSync)');
  // markNotificationRead requires a notificationId to exist; for the spike we send a
  // fabricated one — the resolver may return an error but @aws_subscribe still publishes
  // to subscribers of the mutation. If the spike BFF rejects the mutation entirely
  // (no row to update), swap to invoking a mutation that has no precondition (e.g.
  // initiateDeposit, then mark its notification). See Task 7 for fallback.
  const fabricatedNotificationId = process.env.SPIKE_NOTIFICATION_ID ?? 'spike-' + Date.now();
  try {
    await triggerClient.mutate({
      mutation: gql`
        mutation MarkRead($notificationId: ID!) {
          markNotificationRead(notificationId: $notificationId) {
            notificationId
            readAt
          }
        }
      `,
      variables: { notificationId: fabricatedNotificationId },
    });
  } catch (err) {
    console.warn('[spike] mutation errored (often expected for fabricated ID):', (err as Error).message);
  }

  // Wait up to 15 seconds for a payload.
  await new Promise((r) => setTimeout(r, 15000));

  sub.unsubscribe();
  subClient.stop();
  triggerClient.stop();

  if (received.length > 0) {
    console.log('[spike] PASS — subscription received', received.length, 'payload(s)');
    process.exit(0);
  } else {
    console.error('[spike] FAIL — no subscription payload received within 15s');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[spike] fatal:', err);
  process.exit(2);
});
