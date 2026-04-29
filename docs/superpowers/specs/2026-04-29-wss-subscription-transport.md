# WSS Subscription Transport — Root Cause + Fix Options

**Status:** Phase 1 (library upgrade) shipped + empirically tested 2026-04-29. URL-encoding hypothesis **disproven**. New decisive root cause identified: Amplify v6 `fetchAuthSession()` throws under implicit-grant flow, killing the subscription auth handshake before any WS is opened. See §9.

**Phase 1 result:** `aws-appsync-subscription-link` 4.0.1 → 4.0.3 + `aws-appsync-auth-link` 4.0.1 → 4.0.2. All 158 shell unit tests pass. E2e re-run: **same failure mode** — `waitForDetected` 120s timeout, zero WS frames in trace, zero subscription-error console logs.
**Branch:** `feat/playwright-e2e-ui` (worktree `.worktrees/playwright-e2e`).
**Triggering blocker:** Playwright e2e `waitForDetected` 120s timeout. Zero WS frames in trace, no upgrade event observed at the local proxy, `DepositService.subscribeToDepositEvent` callback never fires.

## 1. Verified root cause

`aws-appsync-subscription-link@4.0.1` **unconditionally appends `/realtime`** to the user-supplied `appSyncGraphqlEndpoint`.

Library source (`node_modules/.pnpm/aws-appsync-subscription-link@4.0.1.../lib/index.mjs`):
- L2669: `var customDomainPath = "/realtime";`
- L3027–3036 (URL derivation, three branches):
  ```
  if (this.proxyUrl) {
    discoverableEndpoint = this.proxyUrl.replace(/\/graphql$/, "").concat(customDomainPath)
                                        .replace("https://","wss://").replace("http://","ws://");
  } else if (this.isCustomDomain(appSyncGraphqlEndpoint)) {
    discoverableEndpoint = appSyncGraphqlEndpoint.concat(customDomainPath)
                                                  .replace("https://","wss://").replace("http://","ws://");
  } else {
    discoverableEndpoint = appSyncGraphqlEndpoint.replace("appsync-api","appsync-realtime-api")...
  }
  ```
- `isCustomDomain` (L2697): returns `true` for any URL not matching `^https://\w{26}\.appsync-api\.\w{2}-\w{2,}-\d\.amazonaws.com/graphql$`. Both `localhost:4200` and `<id>.cloudfront.net` are "custom".

Production wires (`libs/shell/src/graphql/create-apollo-client.ts:22`): `realtimeUrl = ${window.location.origin}/realtime/${domain}` ⇒ library produces:
```
ws://localhost:4200/realtime/investor/realtime?header=<b64>&payload=<b64>
                                ^^^^^^^^^^^^^^^^^^^ 3 path segments
```

CDK CloudFront behavior is **literal exact-match**, not glob (`services/investor/investor-web/src/service.stack.ts:117`):
```
distribution.addBehavior(`/realtime/${entry.key}`, new HttpOrigin(wsHost), { … });
```
A 3-segment URI does not match `/realtime/investor`. CloudFront falls to the **default** behavior (S3 + SPA fallback), returning `200 text/html`. The viewer-request rewrite-fn (`cf-functions/realtime-rewrite.js`) regex is also 2-segment-only: `/^\/(?:realtime|graphql)\/([^/]+)\/?$/`.

Same mismatch in the local e2e proxy: `apps/nestfolio-e2e/tools/serve-mfe.mjs:42` matches `/realtime/*` (would forward), but the browser's library throws/blocks before sending any upgrade because it cannot complete the handshake against an HTTP-200-HTML response. **The library silently surfaces no error**; Apollo `errorLink` doesn't fire, `DepositService` console.error doesn't fire, the `next()` callback never runs.

## 2. Why the spike "passed" but production fails

`tools/spikes/wss-cf-spike/spike-result.log` shows the spike opened the **same** 3-segment URL `wss://d3cwq0godyfc14.cloudfront.net/realtime/investor/realtime` and received a payload. Two reasons:

1. **Spike CF distribution has a single default behavior** (`tools/spikes/wss-cf-spike/src/spike.stack.ts:39`) with origin = AppSync HTTPS host. Any URI is forwarded to AppSync. AppSync's WSS upgrade is host-level, not path-strict — the upgrade succeeds regardless of `request.uri`. **Production CF has 13 specific behaviors**; the 3-segment URI falls to S3.
2. **Spike runs in Node** (`npx ts-node src/test-client.ts`) using Node's native `url.parse`, native `WebSocket` (Node 22+ undici), and a literal Cognito ID-token string passed to `auth.jwtToken` (no async callback). Production runs in browser with `fetchAuthSession()` callback. Even if the URL were correct, the browser path may also surface auth-link issues (Amplify v6 `TokenRefreshException: implicit grant` warnings observed in trace) — but **these are downstream of the URL bug**.

## 3. Reproduction evidence

| Source | URL produced | CF outcome | Result |
|---|---|---|---|
| Spike Node client | `wss://<spikeCF>/realtime/investor/realtime?header=…&payload=…` | Single default behavior → AppSync direct | **PASS** (spike-result.log L9) |
| Production browser via direct CF | `wss://<dev-CF>/realtime/investor/realtime?…` | 13 behaviors; no `/realtime/<dom>*` match → default S3 → 200 HTML | Silent fail (no WS frame) |
| Production browser via local proxy → dev-CF | identical URL | Same as above (proxy is transparent forwarder) | Silent fail |

Code locations corroborating the chain: `libs/shell/src/graphql/create-apollo-client.ts:22`, `libs/shell/src/graphql/graphql.service.ts:48-64`, `services/investor/investor-web/src/cf-functions/realtime-rewrite.js:7`, `apps/nestfolio-e2e/tools/serve-mfe.mjs:42-89`.

## 4. In-app vs. spike differences (full enumeration)

| Aspect | Spike (`tools/spikes/wss-cf-spike/src/test-client.ts`) | Production (`libs/shell/src/graphql/`) |
|---|---|---|
| Runtime | Node | Browser |
| `auth.jwtToken` | Literal string (sync once cached) | Async callback `() => fetchAuthSession()` |
| Token source | `InitiateAuthCommand` USER_PASSWORD_AUTH | Amplify v6 `fetchAuthSession()` (implicit grant) |
| Apollo links | `[authLink, subscriptionLink]` | `[errorLink, authLink, subscriptionLink]` |
| HttpLink fetch | `cross-fetch` | native `fetch` |
| CF topology | Single default behavior → AppSync | 13 behaviors; default → S3 |
| CF rewrite-fn | `^/realtime/([^/]+)/?$` (2-seg) | `^/(?:realtime|graphql)/([^/]+)/?$` (2-seg) |
| URL `url.parse` | Node built-in | Bundled statically inside libs/shell (carve-out from `frontend-deps`) |

Only items 1, 2, 6 are causal; #6 is decisive.

## 5. Fix options

### Option (a) — Library-config workaround via `proxy.url`

Pass `proxy: { url: '<something>/graphql' }` to `createSubscriptionHandshakeLink`. Library branch L3028 strips trailing `/graphql` and concats `/realtime`.

**Problem:** still single-realtime-endpoint per BFF — no way to encode `<domain>` segment in the resulting URL. The library always produces a URL ending in `/realtime`. To get per-domain routing we'd need to pass `proxy: { url: 'http://localhost:4200/realtime/investor/graphql' }` ⇒ produces `ws://localhost:4200/realtime/investor/realtime` — **same 3-segment URL we already have**. Doesn't avoid the CF path-pattern problem.

**Verdict:** does not solve the issue. ~2 LOC, but option fails the goal.

**Affected files:** `libs/shell/src/graphql/create-apollo-client.ts` (1).

### Option (b) — URL-pattern alignment in CF + rewrite-fn (RECOMMENDED)

Accept that the library always appends `/realtime`. Adjust CF behavior + rewrite to handle the 3-segment URL.

**Changes:**
1. `services/investor/investor-web/src/service.stack.ts:117` — change `addBehavior(`/realtime/${entry.key}`, …)` to `addBehavior(`/realtime/${entry.key}*`, …)` (CF wildcard suffix matches both `/realtime/<domain>` and `/realtime/<domain>/realtime`).
2. `services/investor/investor-web/src/cf-functions/realtime-rewrite.js` — extend regex:
   ```js
   var m3 = request.uri.match(/^\/realtime\/([^/]+)\/realtime\/?$/);
   if (m3) { request.uri = '/graphql/realtime'; return request; }
   var m2 = request.uri.match(/^\/(?:realtime|graphql)\/([^/]+)\/?$/);
   if (m2) { request.uri = '/graphql'; return request; }
   ```
   AppSync custom-domain WSS handshake URI is `/graphql/realtime`, not `/graphql`.
3. `tools/spikes/wss-cf-spike/src/path-rewrite.fn.js` — same regex update for parity (so the spike continues to validate the same contract).
4. `services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts` — add 3-seg test cases.

**Pros:** preserves Charter §7 R6 (relative `/realtime/<domain>` URL stays in shell). Smallest blast radius. Compatible with the unchanged library. Enables the next-layer diagnosis (auth/Amplify) by removing the URL block.

**Cons:** CF path-pattern wildcard `/realtime/investor*` also matches future literal `/realtime/investorX` — minor (no other paths planned under `/realtime/`).

**LOC estimate:** CDK +2 LOC, rewrite-fn +5 LOC, spike rewrite-fn +5 LOC, tests +20 LOC. Total ~30 LOC. Re-deploy investor-web only.

**Affected files:** 4 source + 1 test.

### Option (c) — Replace `aws-appsync-subscription-link` with Amplify v6 GraphQL API

Use `aws-amplify/api`'s `generateClient({ authMode: 'userPool' })`. Amplify v6 manages the WSS handshake internally and takes a configured AppSync endpoint. `Amplify.configure({ API: { GraphQL: { endpoint, region, defaultAuthMode } } })` per MFE domain (or via per-route config swap).

**Pros:** Eliminates manual `_awsRealTimeHeaderBasedAuth` path; Amplify v6 already in deps. Library is actively maintained.

**Cons:** Requires per-MFE Amplify config swap (Amplify is a global singleton). Amplify's AppSync URL contract may also append a path suffix — needs its own validation. Apollo features (`errorLink`, `cache`, `subscribe()` Observable) lose direct integration; would need wrapper. Implicit-grant + token-refresh interaction remains.

**LOC estimate:** ~150 LOC across `libs/shell/src/graphql/` (rewrite `GraphqlService.subscribe`, swap link factory, audit per-MFE Amplify config). Bigger refactor; non-trivial test churn.

**Affected files:** `libs/shell/src/graphql/{create-apollo-client,graphql.service,mfe-domain.token}.ts`, related tests, possibly each MFE's `provideMfeGraphql`.

---

## 9. Empirical disprove of §8.2 + new root cause (added 2026-04-29 evening)

After shipping Phase 1 (library 4.0.1 → 4.0.3) and re-running the e2e:

### 9.1. Trace evidence (after upgrade)

| Check | Expected if §8.2 was right | Actual (after 4.0.3) |
|---|---|---|
| `ws:` URL appears in `0-trace.network` | At least one `ws://localhost:4200/realtime/...` | **Zero WS URLs** |
| `[serve-mfe] upgrade` proxy log | Triggered on first WS attempt | **Not triggered** |
| `Deposit subscription error` console.error | Fires if WS handshake fails | **Not fired** |
| Console events total | At least an error from the subscription | **Only 3 events total** in the entire 3.2-min run |
| HTTP `POST /graphql/investor` | Should still work (orthogonal) | ✅ 200, deposit `INITIATED` panel renders with depositId `c9b17f2c…` |

The browser-WebSocket-rejects-malformed-query hypothesis is empirically false. The 4.0.3 URL is clean and would have been accepted, but the library never reaches `new WebSocket(...)` at all.

### 9.2. Decisive console event

The single non-info console event in the trace:
```
[OnboardingChat] CTA fetchAuthSession failed; navigating anyway
TokenRefreshException: Token refresh is not supported when authenticated
with the 'implicit grant' (token) oauth flow.
Please change your oauth configuration to use 'code grant' flow.
```

`OnboardingChat` catches this with try/catch (`apps/onboarding-mfe/.../onboarding-chat.component.ts` `onCtaClick`), logs it, and proceeds. **The shell's `GraphqlService.jwtTokenProvider` does not.**

### 9.3. New root cause

`libs/shell/src/graphql/graphql.service.ts:75-76`:
```ts
jwtTokenProvider: async () =>
  (await fetchAuthSession()).tokens?.idToken?.toString() ?? '',
```

Under Amplify v6 implicit-grant + token-near-expiry conditions, `fetchAuthSession()` **throws** (not returns `null`). The `?? ''` only catches `null`/`undefined`, not exceptions. The throw propagates as a Promise rejection through:

1. `aws-appsync-subscription-link/lib/index.mjs` `_awsRealTimeAuthorizationHeader` line 3148 (`await token.call(void 0)`)
2. → `_awsRealTimeHeaderBasedAuth`'s try/catch (line 3056 case 4 in 4.0.3)
3. → `_initializeWebSocketConnection`'s `rej(err)`
4. → never reaches `new WebSocket(...)`
5. → Apollo's subscription Observable invokes `error()` callback

But the `errorLink` in `create-apollo-client.ts:29-39` only fires `onAuthFailure` for `CombinedGraphQLErrors` with code `UNAUTHORIZED` or `ServerError` 401/403 — a synchronous throw from the auth-token resolver matches **neither** branch, and `onError` from `@apollo/client@4/link/error` swallows it. The `DepositService.subscribeToDepositEvent`'s `error: (err) => console.error(...)` callback never receives the rejection because the link chain absorbs it before propagation completes.

**Net effect: zero WS frames, zero error logs, zero CF traffic — silent failure.**

The §7 R6 URL pattern issue (3-segment `/realtime/<domain>/realtime` vs literal CF behavior path) is **still latent** and would block once auth is fixed. Phase 2 (Option (b) CF + rewrite-fn alignment) remains needed but cannot be empirically validated until auth is fixed.

### 9.4. Why HTTP works but subscriptions don't (despite same `jwtTokenProvider`)

HTTP mutations are issued **synchronously** from the user-action click handler — Amplify's cached idToken is fresh (within 1h TTL, seeded by the e2e fixture), and `fetchAuthSession()` returns it without triggering refresh. The 3× `POST /graphql/investor → 200` succeeded for this reason.

Subscriptions open **after** the mutation completes and after Angular zone tick latency — by which point Amplify's internal token-refresh check may trigger if the cached token is within its refresh-buffer window (default ~5min before expiry; even a fresh seeded token may trip this depending on Amplify v6 internals). The implicit-grant flow has no refresh token, so the refresh attempt throws `TokenRefreshException` — and only on the subscription invocation, not the prior HTTP call.

This also explains why the spike Node client passed: it bypasses `fetchAuthSession()` entirely and uses a literal token string from `InitiateAuthCommand`.

### 9.5. Fix options for Phase 1.5 (auth handshake, NEW phase between 1 and 2)

**Option (α) — try/catch + localStorage fallback in `jwtTokenProvider` (Recommended).**

Read the cached idToken directly from localStorage when `fetchAuthSession()` throws. Same Amplify v6 key format the e2e fixture already documents (`apps/nestfolio-e2e/src/fixtures/seed-amplify-tokens.ts:8-15`):

```ts
// libs/shell/src/graphql/graphql.service.ts
private async resolveJwtToken(): Promise<string> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch (err) {
    // Amplify v6 implicit-grant flow throws TokenRefreshException on refresh
    // attempts. Fall back to the cached token in localStorage — same shape as
    // seed-amplify-tokens.ts uses.
    const clientId = this.authConfig.userPoolClientId;
    const lastUser = localStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.LastAuthUser`);
    if (!lastUser) return '';
    return localStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.${lastUser}.idToken`) ?? '';
  }
}
```

Wire `jwtTokenProvider: () => this.resolveJwtToken()`. ~20 LOC + matching test in `libs/shell/test/graphql/`. Reversible. Compatible with Phase 2.

**Pros:** smallest change. Reuses already-documented localStorage shape. Solves the silent-failure for both HTTP and WSS paths.
**Cons:** localStorage access in shell adds a coupling to Amplify v6 storage shape (already coupled in the e2e fixture; acceptable). The user is still authenticated with implicit-grant; expiring tokens still aren't refreshed (test sessions <1h, fine; production needs Phase β).

**Option (β) — backend Cognito flow change: implicit-grant → authorization-code-grant.**

`services/investor/investor-web/src/service.stack.ts` `userPool.addClient(...)` — switch the OAuth flow. AWS-recommended for SPAs; restores token refresh.

**Pros:** real fix to the underlying OAuth misconfiguration. No client-side workaround needed.
**Cons:** breaks the seed-tokens e2e fixture (no auth-code in test setup). Requires backend redeploy + frontend Amplify config update + e2e fixture rewrite. ~80 LOC scattered across CDK + Amplify config + fixture. Larger blast radius; may surface additional integration issues.

**Option (γ) — bypass Amplify in the shell GraphqlService.**

Read tokens directly from localStorage on every request — never call `fetchAuthSession()` at all. Removes Amplify v6 dependency from the GraphQL transport.

**Pros:** simplest implementation; eliminates an entire class of Amplify-internals coupling.
**Cons:** loses Amplify's automatic token-refresh-on-near-expiry behavior. Not appropriate for production where sessions exceed token TTL. Acceptable as a transitional state; not a long-term answer.

### 9.6. Recommended sequence (revised)

1. **Phase 1.5 — Option (α)** [now]: ship try/catch + localStorage fallback. Re-run e2e. If auth completes → next layer surfaces (likely the §7 R6 URL pattern, Section 5/Option b).
2. **Phase 2 — Option (b)** [if needed]: CF + rewrite-fn alignment after Phase 1.5 unblocks the auth path.
3. **Phase β long-term** [separate ticket]: migrate Cognito OAuth flow to authorization-code-grant; revisit jwtTokenProvider fallback if no longer needed.

### 9.7. Affected files for Phase 1.5

- `libs/shell/src/graphql/graphql.service.ts:71-79` — extract `resolveJwtToken()` private method with try/catch
- `libs/shell/test/graphql/graphql.service.spec.ts` (or equivalent) — add 2 cases: happy path + fetchAuthSession-throws fallback
- `libs/shell/test/graphql/provide-mfe-graphql.test.ts` — already exists; verify no regression

Total: ~25 LOC + 2 tests. Single library, no other MFE touches.


## 6. Recommendation: **Option (b)**

Reasoning:
1. The fundamental defect is a **CF path-pattern misalignment** with the library's documented URL contract — fix the topology, not the consumer.
2. Charter §7 R6 (relative `/realtime/<domain>` from `window.location.origin`) survives unchanged.
3. Smallest, most reversible change. Can be deployed and validated against a single MFE before generalizing.
4. The spike already validates the post-fix flow (it succeeded against a CF that effectively allowed the 3-seg URL).
5. After (b) lands and we still see no WS frame, we have a clean signal to investigate the auth path (hypothesis 2 — `fetchAuthSession`/implicit grant) — that investigation is currently masked by the URL defect.

**Sequencing:** ship (b); re-run e2e; if `waitForDetected` still times out, instrument the subscription link's `_awsRealTimeHeaderBasedAuth` and Apollo subscription observer, examine the next layer.

## 7. Open questions

1. Confirm AppSync's custom-domain WSS handshake URI is `/graphql/realtime` (not `/graphql`). Validate by running the spike Node client against the existing dev CF after applying the rewrite-fn change to the spike's stack.
2. Should the wildcard pattern be `/realtime/<domain>*` (matches `/realtime/investorX`) or `/realtime/<domain>/*` (strict subpath only)? CF treats both as supported; recommend the latter — but it requires a separate behavior for the bare 2-seg case unless the library's HTTP introspection path is unused (it likely is — only WSS hits this behavior).
3. Is the 8-pre-existing `onboarding-chat.component.spec.ts` failure (HttpAgent.headers) related to the same Amplify v6 token shape? Out of scope for this spec.

---

## 8. Library landscape research (added 2026-04-29)

User concern: `aws-appsync-subscription-link` is in maintenance mode — investigate alternatives and upgrade paths.

### 8.1. Maintenance status (verbatim from `awslabs/aws-mobile-appsync-sdk-js` README)

> **The AWS AppSync Apollo links for V3 and V4 are in Maintenance Mode. This means we will continue to include updates to ensure compatibility with backend services and security. No new features will be introduced.**

> For front-end web and mobile development, **we recommend using the AWS Amplify library** which is optimized to connect to the AppSync backend. […] If you want to use the Apollo V3 client, use the Apollo Links in this repository to help with authorization and subscriptions.

**However "maintenance mode" still ships meaningful patches.** Latest version on npm:

| Package | Current pinned | Latest | Latest published |
|---|---|---|---|
| `aws-appsync-subscription-link` | **4.0.1** | **4.0.3** | 2026-03-30 |
| `aws-appsync-auth-link` | (matching) | latest | (paired releases) |

4.0.x explicitly targets Apollo Client v4 + GraphQL v16 — i.e. AWS released a v4-compatible major just 1 month ago.

### 8.2. **DECISIVE**: 4.0.3 changes the WS URL shape

I unpacked `aws-appsync-subscription-link@4.0.3` (`/tmp/appsync-link-403/package/lib/index.mjs`) and diffed it against the pinned 4.0.1.

**4.0.1** (lines 3025–3036) — handshake URL is:
```
ws://<host>/<path>?header=<base64>&payload=<base64>
```
Both query params use plain base64 — they contain `+`, `/`, and `=`. Browser WebSocket may treat this URL as malformed (raw `+` is invalid in query strings; some browsers silently abort the open).

**4.0.3** (lines 3046–3060) — handshake URL is:
```
ws://<host>/<path>
```
Auth is moved into the **WebSocket subprotocol** instead:
```
protocols = ["graphql-ws", "header-<base64url>"]
```
- `base64url` instead of base64 (`+`→`-`, `/`→`_`, strip `=`) — URL-safe.
- No query string. No `?payload=`.
- The browser's `new WebSocket(url, protocols)` call passes the auth via `Sec-WebSocket-Protocol` HTTP header during the upgrade — clean, RFC-compliant.

**This is the most plausible root cause of the silent browser failure.** The browser's `WebSocket` constructor in 4.0.1 receives a URL with `+`/`=` query characters that some browsers reject without dispatching an `error` event. That matches the observed symptom: zero WS frames, no upgrade reaches the proxy, no console error.

The Node `ws` package used in the spike is more lenient about query-string parsing — which explains why the spike PASSED with the same library version.

### 8.3. Amplify v6 — same URL-construction defect

I inspected `@aws-amplify/api-graphql/dist/esm/Providers/AWSWebSocketProvider/appsyncUrl.mjs` (already in deps, version 6.16.2):

```js
const customDomainPath = '/realtime';
const isCustomDomain = (url) =>
    url.match(/^https:\/\/\w{26}\.appsync-api\.\w{2}.../i) === null;

const getRealtimeEndpointUrl = (appSyncGraphqlEndpoint) => {
    let realtimeEndpoint = appSyncGraphqlEndpoint ?? '';
    if (isEventDomain(realtimeEndpoint)) { ... }                    // AppSync Events API
    else if (isCustomDomain(realtimeEndpoint)) {
        realtimeEndpoint = realtimeEndpoint.concat(customDomainPath);  // SAME APPEND
    }
    else { realtimeEndpoint = realtimeEndpoint.replace('appsync-api', 'appsync-realtime-api'); }
    return new AmplifyUrl(realtimeEndpoint.replace('https://', 'wss://').replace('http://', 'wss://'));
};
```

**Amplify v6's GraphQL provider has the IDENTICAL `/realtime` append behavior**. Migrating to `aws-amplify/api`'s `generateClient()` does not avoid the URL pattern issue — the URL-construction logic was simply copied from the same upstream protocol. The `/realtime` suffix is **part of the AppSync custom-domain WSS handshake protocol itself**, not a library quirk.

### 8.4. Other alternatives evaluated

| Path | Verdict |
|---|---|
| **Apollo `graphql-ws` link** | Incompatible. AppSync uses its own WS subprotocol (`graphql-ws` + `header-<b64url>`) with auth-in-subprotocol; the standard `graphql-ws` library implements `graphql-transport-ws`, a different protocol. |
| **AppSync Events API** (new 2024 product) | Different product (`/event` endpoint, not `/graphql`). Pub/sub channels, no GraphQL schema. Would require backend redesign — abandons our schema-typed BFFs. Out of scope for this issue. |
| **Hand-rolled WSS client** | Implement AppSync's documented WS subprotocol against the AppSync host. ~250 LOC. Bypasses both libraries entirely. Highest effort, maximum control, but reinvents what 4.0.3 already does correctly. |
| **Amplify v6 `aws-amplify/api`** | Same `/realtime` append issue (§8.3). The v6 client adds `Amplify.configure()` global-singleton constraint (per-MFE config swap on route change is racy). Higher migration cost (~150 LOC) for no actual fix. |

### 8.5. Refined recommendation

The fundamental issue is **two-layered**:

- **Layer 1 (browser-side silent failure):** the 4.0.1 URL contains base64 query params with `+`/`/`/`=` characters; some browsers silently abort. **Fixed in 4.0.3** (auth moved to WS subprotocol).
- **Layer 2 (URL/CF mismatch):** the library appends `/realtime` to the user-supplied URL, producing `/realtime/<domain>/realtime`. Production CF behavior path patterns are exact-match. This persists regardless of library choice (Amplify v6 has identical logic).

**Recommended sequence:**

1. **Phase 1 — upgrade `aws-appsync-subscription-link` 4.0.1 → 4.0.3** (and bump `aws-appsync-auth-link` to its matching latest). 1 LOC in `package.json`. May resolve the silent-browser-failure on its own; the URL is now clean and the WS upgrade reaches CloudFront.
2. **Phase 2 — Option (b) CF + rewrite-fn alignment** (still needed because the `/realtime` suffix is a protocol invariant). After phase 1, run e2e:
   - If WS upgrade now reaches CF and CF responds 200 HTML → Phase 2 confirmed needed; ship (b).
   - If WS still doesn't open → instrument Apollo link chain + `_awsRealTimeHeaderBasedAuth` (separate diagnostic).

**De-recommended:** Option (c) [Amplify v6 swap] — same defect, larger migration. **Discard.**

**Long-term consideration:** when you genuinely outgrow AppSync GraphQL subscriptions (e.g. pure pub/sub with no schema benefit, or you want first-party support), migrate that workload to **AppSync Events API** — but treat it as a backend redesign decision, not a frontend transport choice.

### 8.6. Affected files for the recommended path

**Phase 1 (upgrade):**
- `package.json` — bump `aws-appsync-subscription-link` to `^4.0.3`, `aws-appsync-auth-link` to matching latest
- `pnpm-lock.yaml` — regenerated by `pnpm install`
- Run unit + integration suites; spike Node client should still pass

**Phase 2 (CF alignment, only if Phase 1 doesn't fully resolve):**
- `services/investor/investor-web/src/service.stack.ts:117` — change `addBehavior(`/realtime/${entry.key}`, …)` to `addBehavior(`/realtime/${entry.key}/*`, …)` and add a separate behavior for the bare `/realtime/<key>` if HTTP introspection is needed (likely not)
- `services/investor/investor-web/src/cf-functions/realtime-rewrite.js` — extend regex to handle 3-seg URI → `/graphql/realtime`
- `services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts` — add 3-seg test cases
- `tools/spikes/wss-cf-spike/src/path-rewrite.fn.js` — same regex update for parity

Total: ~30 LOC across 4 files (only if Phase 1 doesn't suffice).

