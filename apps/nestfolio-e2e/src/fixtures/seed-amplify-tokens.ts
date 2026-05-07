import type { Page } from '@playwright/test';
import type { CognitoTokens } from '@nestfolio/test-support';

/**
 * Amplify v6 localStorage key format (verified against aws-amplify@6.16.2 / @aws-amplify/auth@6.19.1
 * on 2026-04-22):
 *   CognitoIdentityServiceProvider.<clientId>.LastAuthUser              = <username>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.idToken        = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.accessToken    = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.refreshToken   = ''
 *   CognitoIdentityServiceProvider.<clientId>.<username>.clockDrift     = '0'
 *
 * If Amplify is upgraded, re-run the Spike-1.1 verification (sign in via the host UI
 * and snapshot the keys in DevTools → Application → Local Storage), then update both
 * the comment above and the keys below.
 */

export interface SeedOptions {
  clientId: string;
  username: string;
  tokens: CognitoTokens;
}

export async function seedAmplifyTokens(page: Page, opts: SeedOptions): Promise<void> {
  const { clientId, username, tokens } = opts;
  await page.addInitScript(
    ({ clientId, username, idToken, accessToken, refreshToken }) => {
      const prefix = `CognitoIdentityServiceProvider.${clientId}`;
      localStorage.setItem(`${prefix}.LastAuthUser`, username);
      localStorage.setItem(`${prefix}.${username}.idToken`, idToken);
      localStorage.setItem(`${prefix}.${username}.accessToken`, accessToken);
      // A real refreshToken is required: Amplify v6 reads this slot at session
      // resolution time, and an empty value is interpreted as "OAuth implicit
      // grant" (no refresh capability), causing fetchAuthSession() to throw
      // TokenRefreshException — which silently kills the AppSync subscription
      // auth handshake before any WS is opened.
      localStorage.setItem(`${prefix}.${username}.refreshToken`, refreshToken);
      localStorage.setItem(`${prefix}.${username}.clockDrift`, '0');
      // Activate the WSS protocol-frame probe in libs/shell. Logs raw AppSync
      // graphql-ws frames to console for diagnosing subscription failures.
      // No-op in production where this flag is never set.
      (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug = true;
    },
    {
      clientId,
      username,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
  );
}

/**
 * Call AFTER navigating to the host root. Fails fast if the seeded Amplify v6
 * localStorage keys are missing — that's the silent-failure mode of wrong-keys,
 * the single largest time-sink risk in this harness.
 *
 * We check localStorage directly rather than calling `fetchAuthSession()` because
 * the host page bootstraps Amplify through a Native Federation importmap, and a
 * fresh `await import('aws-amplify/auth')` from inside `page.evaluate()` runs in
 * a separate script context that doesn't see the importmap and fails to resolve
 * the module specifier. Verifying the storage shape directly is the operative
 * check anyway — if the keys are present, Amplify reads them at boot.
 */
export async function assertAmplifySessionAlive(
  page: Page,
  opts: { clientId: string; username: string },
): Promise<void> {
  const present = await page.evaluate(
    ({ clientId, username }) => {
      const prefix = `CognitoIdentityServiceProvider.${clientId}`;
      return {
        lastAuthUser: localStorage.getItem(`${prefix}.LastAuthUser`),
        idTokenPresent: !!localStorage.getItem(`${prefix}.${username}.idToken`),
        accessTokenPresent: !!localStorage.getItem(`${prefix}.${username}.accessToken`),
      };
    },
    { clientId: opts.clientId, username: opts.username },
  );
  if (
    present.lastAuthUser !== opts.username ||
    !present.idTokenPresent ||
    !present.accessTokenPresent
  ) {
    throw new Error(
      'seedAmplifyTokens: localStorage missing expected Amplify v6 keys after seeding ' +
        `(LastAuthUser=${present.lastAuthUser ?? 'null'}, idToken=${present.idTokenPresent}, accessToken=${present.accessTokenPresent}). ` +
        'Amplify v6 key format may have changed — re-run the Spike 1.1 verification.',
    );
  }
}
