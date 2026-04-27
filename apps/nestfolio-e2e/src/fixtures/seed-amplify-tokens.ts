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
    ({ clientId, username, idToken, accessToken }) => {
      const prefix = `CognitoIdentityServiceProvider.${clientId}`;
      localStorage.setItem(`${prefix}.LastAuthUser`, username);
      localStorage.setItem(`${prefix}.${username}.idToken`, idToken);
      localStorage.setItem(`${prefix}.${username}.accessToken`, accessToken);
      // refreshToken is intentionally empty — test sessions are short-lived
      // (idToken TTL is 1h; the journey runs in <5min). If a future test needs >1h,
      // capture a real refreshToken in CognitoFixture and plumb it through.
      localStorage.setItem(`${prefix}.${username}.refreshToken`, '');
      localStorage.setItem(`${prefix}.${username}.clockDrift`, '0');
    },
    { clientId, username, idToken: tokens.idToken, accessToken: tokens.accessToken },
  );
}

/**
 * Call AFTER navigating to the host root. Fails fast if `fetchAuthSession()` still
 * returns null after seeding — that's the silent-failure mode of wrong-keys, the
 * single largest time-sink risk in this harness.
 */
export async function assertAmplifySessionAlive(page: Page): Promise<void> {
  const session = await page.evaluate(async () => {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const s = await fetchAuthSession();
    return {
      hasIdToken: !!s.tokens?.idToken?.toString(),
      hasAccessToken: !!s.tokens?.accessToken?.toString(),
    };
  });
  if (!session.hasIdToken || !session.hasAccessToken) {
    throw new Error(
      'seedAmplifyTokens: fetchAuthSession() returned no tokens after seeding. ' +
        'Amplify v6 key format may have changed — re-run the Spike 1.1 verification.',
    );
  }
}
