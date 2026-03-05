# 04 -- Frontend Architecture Plan

Angular microfrontend architecture, AppSync integration, design system, screen implementation, i18n, and Cognito integration for Nestfolio.

> **Phase scheme**: See [00-master-plan.md](./00-master-plan.md) for phase definitions (Phase 1 Foundation, Phase 2 Core Domain, Phase 3 AI Agent System, Phase 4 Frontend, Phase 5 Observability).
>
> [Back to Master Plan](./00-master-plan.md)

---

## 1. Angular Microfrontend Architecture

### 1.1 Module Federation Approach: Angular Native Federation

**Recommendation: `@angular-architects/native-federation`** (Native Federation).

Angular moved to esbuild as the default builder starting with Angular 17 and formalized it further in 18/19. The older `@angular-architects/module-federation` package depends on webpack and the deprecated `@angular-devkit/build-angular:browser` builder. Native Federation replaces it with an esbuild-compatible implementation that uses ES Module import maps instead of webpack's Module Federation runtime.

| Criteria | `@angular-architects/module-federation` (webpack) | `@angular-architects/native-federation` (esbuild) |
|---|---|---|
| Builder compatibility | Requires webpack builder (deprecated) | Works with esbuild (default since Angular 17+) |
| Build speed | Slower (webpack) | Significantly faster (esbuild) |
| Runtime overhead | webpack runtime chunk-loading | ES import maps (browser-native) |
| Angular version alignment | Works but fighting the default toolchain | Aligned with Angular's direction |
| Maintenance trajectory | Maintained but legacy path | Active development, recommended by the Angular architects team |
| Shared dependency handling | Built-in via webpack shared config | Built-in via `share` config in federation manifest |

**Rationale for a solo developer:** Native Federation is the forward-compatible choice. Using the webpack-based approach means maintaining a custom builder config that Angular CLI updates may break. Native Federation keeps the project on the default Angular CLI toolchain, reducing maintenance burden.

### 1.2 Shell Application (`investor-web`)

The shell application is the CloudFront entry point. It owns:

- **Routing**: Top-level `Router` that lazy-loads remote microfrontends based on path segments
- **Authentication**: Cognito session management, JWT refresh, auth guards
- **Shared state**: Tenant context, auth tokens, and user profile stored in a shared Angular service exposed via the federation manifest
- **Layout chrome**: Status bar, bottom tab bar (mobile), sidebar navigation (desktop), global loading/error states
- **CloudFront distribution**: Single CloudFront distribution with path-based origin routing

```typescript
// Shell application routing configuration (app.routes.ts)
import { loadRemoteModule } from '@angular-architects/native-federation';

export const APP_ROUTES: Routes = [
  {
    path: '',
    component: ShellLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          loadRemoteModule('portfolio-mfe', './DashboardComponent')
            .then(m => m.DashboardComponent),
      },
      {
        path: 'portfolio',
        loadComponent: () =>
          loadRemoteModule('portfolio-mfe', './PortfolioDetailComponent')
            .then(m => m.PortfolioDetailComponent),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          loadRemoteModule('investor-mfe', './NotificationsComponent')
            .then(m => m.NotificationsComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          loadRemoteModule('investor-mfe', './SettingsComponent')
            .then(m => m.SettingsComponent),
      },
      {
        path: 'decision/:id',
        loadComponent: () =>
          loadRemoteModule('advisory-mfe', './DecisionDetailComponent')
            .then(m => m.DecisionDetailComponent),
      },
      {
        path: 'confirm/:id',
        loadComponent: () =>
          loadRemoteModule('advisory-mfe', './ConfirmationComponent')
            .then(m => m.ConfirmationComponent),
      },
      {
        path: 'onboarding',
        loadComponent: () =>
          loadRemoteModule('investor-mfe', './OnboardingComponent')
            .then(m => m.OnboardingComponent),
        canActivate: [onboardingGuard],
      },
    ],
  },
  { path: 'landing', component: LandingComponent },
  { path: '**', redirectTo: 'dashboard' },
];
```

### 1.3 Microfrontend Modules

Each BFF owns one microfrontend deployed independently to its S3 bucket.

| Microfrontend | BFF Owner | Screens | S3 Origin |
|---|---|---|---|
| `portfolio-mfe` | `portfolio-bff` | Dashboard (portfolio value, chart), Portfolio Detail (4 tabs) | `s3://portfolio-bff-{env}-assets/mfe/` |
| `advisory-mfe` | `advisory-bff` | Decision Detail ("Why"), Confirmation Dialog, Status Banner, Safety Rules | `s3://advisory-bff-{env}-assets/mfe/` |
| `investor-mfe` | `investor-bff` | Onboarding Conversation, Settings & Profile, Deposit Flow, Withdrawal Flow, Account Closure, How Nestfolio Works, Notifications, Recent Activity | `s3://investor-bff-{env}-assets/mfe/` |

The shell application (`investor-web`) serves: Landing/Marketing, Sign Up/Sign In (Cognito hosted UI redirect), and the layout chrome.

### 1.4 CloudFront Path-Based Routing

A single CloudFront distribution routes to different S3 origins based on URL path patterns.

```
CloudFront Distribution (nestfolio.app)
  |
  |-- /                        -> investor-web S3 (shell app)
  |-- /assets/portfolio-mfe/*  -> portfolio-bff S3 (remote entry + chunks)
  |-- /assets/advisory-mfe/*   -> advisory-bff S3 (remote entry + chunks)
  |-- /assets/investor-mfe/*   -> investor-bff S3 (remote entry + chunks)
  |-- /api/portfolio/*         -> portfolio-bff AppSync
  |-- /api/advisory/*          -> advisory-bff AppSync
  |-- /api/investor/*          -> investor-bff AppSync
```

CDK configuration for the CloudFront distribution:

```typescript
// In investor-web CDK stack (facade.ts)
const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(shellBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
  },
  additionalBehaviors: {
    '/assets/portfolio-mfe/*': {
      origin: new origins.S3Origin(portfolioBffAssetsBucket),
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
    '/assets/advisory-mfe/*': {
      origin: new origins.S3Origin(advisoryBffAssetsBucket),
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
    '/assets/investor-mfe/*': {
      origin: new origins.S3Origin(investorBffAssetsBucket),
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
  },
  defaultRootObject: 'index.html',
  errorResponses: [
    {
      httpStatus: 404,
      responseHttpStatus: 200,
      responsePagePath: '/index.html', // SPA fallback
    },
  ],
});
```

### 1.5 Shared Dependencies

Native Federation manages shared dependencies via the federation manifest. The shell declares which packages are shared, and remotes consume the shell's versions at runtime.

```typescript
// federation.config.js (shell)
const { withNativeFederation, share } = require('@angular-architects/native-federation/config');

module.exports = withNativeFederation({
  name: 'shell',
  shared: share({
    '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/router': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/forms': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    'rxjs': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
    '@nestfolio/ui-components': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@nestfolio/appsync-client': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@nestfolio/auth': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  }),
});
```

Shared libraries published as Nx libraries:

| Library | Purpose | Shared? |
|---|---|---|
| `libs/ui-components` | Design system component library | Yes, singleton |
| `libs/appsync-client` | AppSync multi-endpoint client wrapper | Yes, singleton |
| `libs/auth` | Cognito auth service, guards, interceptors | Yes, singleton |
| `libs/i18n` | Locale service, formatters, translation pipes | Yes, singleton |
| `libs/shared-state` | Tenant context, user profile signals | Yes, singleton |

### 1.6 Inter-Microfrontend Communication

Microfrontends from different BFFs share state via three mechanisms:

**1. Shared singleton services (via federation)**

The `@nestfolio/shared-state` library exposes Angular signals for tenant context, auth state, and user profile. Since it is loaded as a singleton, all microfrontends read from the same instance.

```typescript
// libs/shared-state/src/tenant-context.service.ts
@Injectable({ providedIn: 'root' })
export class TenantContextService {
  private readonly _tenantId = signal<string | null>(null);
  private readonly _userId = signal<string | null>(null);
  private readonly _authToken = signal<string | null>(null);
  private readonly _locale = signal<string>('it-IT');

  readonly tenantId = this._tenantId.asReadonly();
  readonly userId = this._userId.asReadonly();
  readonly authToken = this._authToken.asReadonly();
  readonly locale = this._locale.asReadonly();

  setAuthContext(token: DecodedJwt): void {
    this._tenantId.set(token.tenantId);
    this._userId.set(token.sub);
    this._authToken.set(token.raw);
  }
}
```

**2. Router-based communication**

Query parameters and route data pass context between microfrontends. For example, a notification links to `/decision/dec-123` which the advisory-mfe reads from `ActivatedRoute`.

**3. CustomEvent for cross-MFE notifications**

For fire-and-forget signals (e.g., "a confirmation was submitted, refresh the dashboard status"), microfrontends dispatch `CustomEvent` on `window`:

```typescript
// advisory-mfe dispatches after user confirms
window.dispatchEvent(new CustomEvent('nestfolio:confirmation-submitted', {
  detail: { decisionId: 'dec-123', action: 'confirmed' }
}));

// portfolio-mfe listens
@HostListener('window:nestfolio:confirmation-submitted', ['$event'])
onConfirmation(event: CustomEvent) {
  this.dashboardService.refreshStatus();
}
```

### 1.7 Microfrontend Architecture: All 3 Remotes

All 3 MFE remotes are implemented in the prototype (Phase 4). This validates the full federation pattern end-to-end and establishes the deployment infrastructure for all BFF-scoped remotes from day one.

#### Architecture Summary

```
                    investor-web (Shell Host)
                    ├── Landing (static, no auth)
                    ├── Sign Up / Sign In (Cognito redirect)
                    ├── Layout chrome (status bar, tab bar, nav)
                    └── Routes → loadRemoteModule(...)
                           │
              ┌────────────┼────────────┐
              │            │            │
     portfolio-mfe   advisory-mfe  investor-mfe
     (portfolio-bff) (advisory-bff) (investor-bff)
     ├── Dashboard    ├── Decision   ├── Onboarding
     └── Portfolio    │   Detail     ├── Notifications
         Detail       └── Confirm    ├── Settings
                          Dialog     ├── Deposit
                                     ├── Withdrawal
                                     └── How It Works
```

#### Remote-to-BFF Mapping (Complete)

| Remote | BFF Owner | Screens | S3 Origin | `federation.config.js` exposes |
|---|---|---|---|---|
| `portfolio-mfe` | `portfolio-bff` | Dashboard (portfolio value, chart, recent activity, action-required), Portfolio Detail (4 tabs: holdings, allocation, performance, history) | `s3://{prefix}-portfolio-bff-assets/mfe/` | `./DashboardComponent`, `./PortfolioDetailComponent` |
| `advisory-mfe` | `advisory-bff` | Decision Detail ("Why?"), Confirmation Dialog | `s3://{prefix}-advisory-bff-assets/mfe/` | `./DecisionDetailComponent`, `./ConfirmationComponent` |
| `investor-mfe` | `investor-bff` | Onboarding (Conversational Chat UI), Notifications, Settings & Profile, Deposit Flow, Withdrawal Flow, How Nestfolio Works | `s3://{prefix}-investor-bff-assets/mfe/` | `./OnboardingComponent`, `./NotificationsComponent`, `./SettingsComponent`, `./DepositComponent`, `./WithdrawalComponent`, `./HowItWorksComponent` |

#### Shell Host: `investor-web`

The shell owns **no domain screens** — it only provides:
- Landing/Marketing page (static, unauthenticated)
- Sign Up / Sign In (Cognito hosted UI redirect)
- Layout chrome: status bar, bottom tab bar (mobile), sidebar (desktop), global loading/error states
- Authentication context (Cognito session management, JWT refresh, auth guards)
- Shared state distribution (tenant context, user profile via `@nestfolio/shared-state`)
- CloudFront distribution with path-based origin routing

#### Build & Deployment

Each MFE remote has its own:
- `federation.config.js` declaring exposed components and shared dependencies
- `build` Nx target producing the remote entry bundle
- `deploy` Nx target uploading the bundle to its BFF's S3 bucket
- Independent deployment — updating `advisory-mfe` does not require redeploying `portfolio-mfe`

#### Local Development

For local development, all MFEs run simultaneously via Nx parallel serve:

```bash
# Start shell + all 3 remotes in dev mode
pnpm nx run-many -t serve -p investor-app portfolio-mfe advisory-mfe investor-mfe --parallel=4
```

The shell's `federation.manifest.json` points to `http://localhost:{port}/remoteEntry.json` for each remote during development, and to the CloudFront S3 origins in deployed environments.

### 1.8 Progressive Web App (PWA)

Phase 4 ships as a Progressive Web App. When installed via "Add to Home Screen" on Android or iOS, the PWA launches in full-screen standalone mode with no browser chrome -- providing a native-feeling experience with zero native tooling.

#### 1.8.1 Service Worker Setup

Install `@angular/service-worker` and register it in the application bootstrap:

```bash
ng add @angular/service-worker
```

The service worker provides:
- **Precaching** of the app shell (index.html, JS bundles, CSS, fonts)
- **Runtime caching** of API responses with a network-first strategy
- **Offline fallback** to the cached shell when the device is offline

The `ngsw-config.json` controls cache groups. Static assets use a `prefetch` install mode; API calls use `lazy` with a `freshness` strategy.

#### 1.8.2 Web App Manifest

`src/manifest.webmanifest`:

```json
{
  "name": "Nestfolio",
  "short_name": "Nestfolio",
  "description": "AI-managed investing, explained",
  "start_url": "/dashboard",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#1B6B4A",
  "background_color": "#FAFBFC",
  "icons": [
    { "src": "assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "assets/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

#### 1.8.3 Device Installation

1. **Android**: Navigate to `https://nestfolio.app` in Chrome. Tap the browser menu -> "Add to Home Screen" (or accept the install prompt if it appears). The app launches full-screen with the `#1B6B4A` status bar color and no browser chrome.
2. **iOS**: Navigate to `https://nestfolio.app` in Safari. Tap the Share button -> "Add to Home Screen". The app launches in standalone mode.
3. **Verify full-screen**: Open the installed PWA -- it should show the Nestfolio splash screen and load without any browser URL bar. The `display: standalone` manifest setting ensures this behavior on both platforms.

---

## 2. AppSync Integration

### 2.1 GraphQL Client: AWS Amplify v6

**Recommendation: AWS Amplify v6 (`aws-amplify`)** with the modular API client.

| Option | Pros | Cons |
|---|---|---|
| AWS Amplify v6 | Tree-shakeable, built for AppSync, handles auth/subscriptions natively, Angular-friendly | Opinionated, larger bundle if not tree-shaken |
| Apollo Client + AppSync link | Flexible, strong caching, community ecosystem | Requires manual auth integration, AppSync link is a maintenance burden |
| Raw AppSync SDK | Lightweight, no abstractions | No caching, no subscription management, more boilerplate |

Amplify v6 is the pragmatic choice for a solo developer: auth, GraphQL, and real-time subscriptions work together out of the box with Cognito. The modular import structure means only the needed modules are bundled.

### 2.2 Schema-per-BFF: Multi-Endpoint Configuration

Each BFF exposes its own AppSync API. The frontend must connect to three AppSync endpoints.

```typescript
// libs/appsync-client/src/appsync-config.ts
export interface AppSyncEndpoint {
  name: string;
  endpoint: string;
  region: string;
  authMode: 'AMAZON_COGNITO_USER_POOLS';
}

export const APPSYNC_ENDPOINTS: Record<string, AppSyncEndpoint> = {
  investor: {
    name: 'investor-bff',
    endpoint: environment.investorApiUrl,
    region: environment.awsRegion,
    authMode: 'AMAZON_COGNITO_USER_POOLS',
  },
  advisory: {
    name: 'advisory-bff',
    endpoint: environment.advisoryApiUrl,
    region: environment.awsRegion,
    authMode: 'AMAZON_COGNITO_USER_POOLS',
  },
  portfolio: {
    name: 'portfolio-bff',
    endpoint: environment.portfolioApiUrl,
    region: environment.awsRegion,
    authMode: 'AMAZON_COGNITO_USER_POOLS',
  },
};
```

```typescript
// libs/appsync-client/src/appsync-client.service.ts
@Injectable({ providedIn: 'root' })
export class AppSyncClientService {
  private clients = new Map<string, GraphQLClient>();

  constructor(private auth: AuthService) {}

  async query<T>(bff: 'investor' | 'advisory' | 'portfolio', query: string, variables?: Record<string, unknown>): Promise<T> {
    const endpoint = APPSYNC_ENDPOINTS[bff];
    const token = await this.auth.getAccessToken();
    // Execute GraphQL query against the correct AppSync endpoint
    return this.executeQuery(endpoint, token, query, variables);
  }

  subscribe<T>(bff: 'investor' | 'advisory' | 'portfolio', subscription: string, variables?: Record<string, unknown>): Observable<T> {
    const endpoint = APPSYNC_ENDPOINTS[bff];
    // Return an Observable wrapping the AppSync WebSocket subscription
    return this.createSubscription(endpoint, subscription, variables);
  }
}
```

### 2.3 Real-Time Subscriptions

AppSync subscriptions provide real-time updates over WebSocket.

| Screen | Subscription | BFF | Trigger Event |
|---|---|---|---|
| Dashboard -- portfolio value | `onPortfolioSummaryUpdated` | `portfolio-bff` | `POSITION_UPDATED`, `CASH_BALANCE_UPDATED` |
| Dashboard -- notifications | `onNotificationCreated` | `investor-bff` | `NOTIFICATION_CREATED` |
| Dashboard -- action required | `onConfirmationRequested` | `advisory-bff` | `USER_CONFIRMATION_REQUESTED` |
| Portfolio Detail -- positions | `onPositionUpdated` | `portfolio-bff` | `POSITION_UPDATED` |
| Notifications -- inbox | `onNotificationCreated` | `investor-bff` | `NOTIFICATION_CREATED` |

```graphql
# portfolio-bff schema.graphql
type Subscription {
  onPortfolioSummaryUpdated(tenantId: String!): PortfolioSummary
    @aws_subscribe(mutations: ["updatePortfolioSummary"])

  onPositionUpdated(tenantId: String!): Position
    @aws_subscribe(mutations: ["updatePosition"])
}
```

```typescript
// Dashboard component subscription setup
@Component({ ... })
export class DashboardComponent implements OnInit, OnDestroy {
  private subscriptions: Subscription[] = [];

  constructor(
    private appsync: AppSyncClientService,
    private tenant: TenantContextService,
  ) {}

  ngOnInit(): void {
    const tenantId = this.tenant.tenantId();

    // Portfolio value updates
    this.subscriptions.push(
      this.appsync.subscribe('portfolio', PORTFOLIO_SUMMARY_SUBSCRIPTION, { tenantId })
        .subscribe(summary => this.portfolioSummary.set(summary))
    );

    // New notifications
    this.subscriptions.push(
      this.appsync.subscribe('investor', NOTIFICATION_CREATED_SUBSCRIPTION, { tenantId })
        .subscribe(notification => this.recentActivity.update(list => [notification, ...list.slice(0, 2)]))
    );

    // Confirmation requests
    this.subscriptions.push(
      this.appsync.subscribe('advisory', CONFIRMATION_REQUESTED_SUBSCRIPTION, { tenantId })
        .subscribe(request => this.pendingConfirmation.set(request))
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }
}
```

### 2.4 Authentication Flow: Cognito JWT to AppSync

```
1. User authenticates via Cognito (hosted UI or custom UI)
2. Cognito returns: idToken, accessToken, refreshToken
3. Shell stores tokens via AuthService
4. Every AppSync request includes the Cognito JWT in the Authorization header
5. AppSync Lambda authorizer validates JWT and extracts tenantId
6. Subscriptions use the same JWT for WebSocket authentication
```

Token refresh is handled automatically by Amplify's auth module. The `AuthService` listens for token expiry and refreshes transparently.

### 2.5 Offline Behavior (Implemented in Prototype)

Nestfolio is an investment app — showing stale data is far better than showing nothing, but mutating financial state offline is dangerous. The offline strategy follows a **read-only offline, optimistic mutations** pattern.

#### Connection Detection

```typescript
// libs/shared-state/src/connectivity.service.ts
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly _online = signal(navigator.onLine);
  private readonly _appSyncConnected = signal(true);
  readonly online = this._online.asReadonly();
  readonly appSyncConnected = this._appSyncConnected.asReadonly();
  /** True when device is online AND AppSync WebSocket is connected */
  readonly fullyConnected = computed(() => this._online() && this._appSyncConnected());

  constructor() {
    window.addEventListener('online', () => this._online.set(true));
    window.addEventListener('offline', () => this._online.set(false));
    // AppSync connection state monitored via subscription error handlers
  }
}
```

#### Offline Banner

When `fullyConnected()` is `false`, a persistent banner is displayed at the top of every screen:

```
┌──────────────────────────────────────────────┐
│ ⚠ Offline — Showing last known data          │
│ Last updated: 10 min ago                     │
└──────────────────────────────────────────────┘
```

The banner uses `ConnectivityService` and shows the age of the cached data. It auto-dismisses when connectivity is restored.

#### Per-Screen Offline Behavior

| Screen | Offline Behavior | Cached Data | Mutations |
|---|---|---|---|
| **Landing** | Fully available (static content, precached by SW) | All static assets | N/A |
| **Dashboard** | Shows cached portfolio value, positions, notifications. Staleness indicator on each card ("Last updated: X min ago"). Real-time subscriptions suspended. | `localStorage`: `portfolioSummary`, `recentNotifications`, `pendingConfirmation` | None — read-only |
| **Portfolio Detail** | Shows cached positions and performance. Charts render from cached data. | `localStorage`: `positions[]`, `performanceMetrics` | None — read-only |
| **Decision Detail** | Shows cached explanation if previously viewed. If never viewed, shows "Unable to load — you're offline." | `localStorage`: `explanation:{decisionId}` (cached on first view) | None — read-only |
| **Confirmation Dialog** | **Optimistic UI**: User can confirm/reject. Action is queued locally. On reconnect, action is submitted. If submission fails (e.g., decision expired), revert and show error. | `localStorage`: `pendingConfirmations[]` | Queued, submitted on reconnect |
| **Notifications** | Shows cached notifications list. New notifications not received (subscriptions suspended). | `localStorage`: `notifications[]` | `markAsRead` queued, submitted on reconnect |
| **Onboarding** | Blocked — onboarding requires real-time API calls. Shows "Please connect to continue setup." | None | Blocked |
| **Settings** | Shows cached profile. Edits blocked. | `localStorage`: `investorProfile` | Blocked — shows "Connect to save changes" |
| **Deposit/Withdrawal** | Blocked — financial transactions require connectivity. Shows "Please connect to manage funds." | None | Blocked |

#### Caching Strategy

```typescript
// libs/shared-state/src/offline-cache.service.ts
@Injectable({ providedIn: 'root' })
export class OfflineCacheService {
  private readonly PREFIX = 'nf:';

  /** Cache data with timestamp for staleness tracking */
  set<T>(key: string, data: T): void {
    localStorage.setItem(`${this.PREFIX}${key}`, JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
    }));
  }

  /** Retrieve cached data with age calculation */
  get<T>(key: string): { data: T; cachedAt: Date; ageMinutes: number } | null {
    const raw = localStorage.getItem(`${this.PREFIX}${key}`);
    if (!raw) return null;
    const { data, cachedAt } = JSON.parse(raw);
    const cachedDate = new Date(cachedAt);
    return {
      data,
      cachedAt: cachedDate,
      ageMinutes: Math.floor((Date.now() - cachedDate.getTime()) / 60000),
    };
  }
}
```

#### Optimistic Mutation Queue

For confirmation and mark-as-read actions that are allowed offline:

```typescript
// libs/shared-state/src/mutation-queue.service.ts
@Injectable({ providedIn: 'root' })
export class MutationQueueService {
  private readonly QUEUE_KEY = 'nf:pendingMutations';

  /** Queue a mutation for submission when connectivity returns */
  enqueue(mutation: PendingMutation): void {
    const queue = this.getQueue();
    queue.push({ ...mutation, queuedAt: new Date().toISOString() });
    localStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
  }

  /** On reconnect, flush all queued mutations in order */
  async flush(appsync: AppSyncClientService): Promise<FlushResult[]> {
    const queue = this.getQueue();
    const results: FlushResult[] = [];
    for (const mutation of queue) {
      try {
        await appsync.mutate(mutation.bff, mutation.query, mutation.variables);
        results.push({ mutation, success: true });
      } catch (error) {
        results.push({ mutation, success: false, error });
      }
    }
    // Clear queue — failed mutations are surfaced to the user
    localStorage.removeItem(this.QUEUE_KEY);
    return results;
  }
}
```

#### Service Worker Strategy

```json
// ngsw-config.json
{
  "assetGroups": [
    {
      "name": "shell",
      "installMode": "prefetch",
      "resources": {
        "files": ["/index.html", "/*.css", "/*.js", "/assets/icons/*"]
      }
    },
    {
      "name": "mfe-bundles",
      "installMode": "lazy",
      "updateMode": "prefetch",
      "resources": {
        "urls": ["/assets/portfolio-mfe/**", "/assets/advisory-mfe/**", "/assets/investor-mfe/**"]
      }
    }
  ],
  "dataGroups": []
}
```

**Key decisions**:
- **Shell assets**: Prefetched on install — app shell always loads offline
- **MFE bundles**: Lazy-fetched on first use, then precached — remote components available offline after first visit
- **API data**: **Not cached by SW** — staleness is managed at the component level via `OfflineCacheService` with explicit age tracking. This avoids the complexity of SW-managed API cache invalidation.

---

## 3. Design System & Component Library

### 3.1 Library Structure

Published as an Nx library at `libs/ui-components`, the design system is the single source of truth for visual components.

```
libs/ui-components/
  src/
    lib/
      tokens/
        _colors.scss           # CSS custom properties from shared.css
        _typography.scss       # Font sizes, weights, families
        _spacing.scss          # Radius, shadows, spacing scale
        _breakpoints.scss      # <640px, 640-1024px, >1024px
      components/
        card/                  # Card, CardAccent
        button/                # BtnPrimary, BtnSecondary, BtnOutline, BtnDanger
        badge/                 # BadgePill (green, amber, red, primary)
        list-item/             # ListItem with icon, content, trailing value
        expandable-section/    # Expandable with header, arrow, content
        toggle/                # Toggle switch
        gauge/                 # Progress bar / risk band gauge
        status-indicator/      # StatusDot (green, amber, red)
        notification-icon/     # NotifIcon with severity-based colors
        tab-bar/               # BottomTabs, ContentTabs
        nav-header/            # NavHeader with back button, title
        chart-placeholder/     # Sparkline chart container
        period-selector/       # ChartPeriods (1S, 1M, 3M, etc.)
        section-label/         # Uppercase section header
        divider/               # Horizontal divider
        skeleton/              # Skeleton loading placeholders
        glossary-tooltip/      # Contextual financial term tooltip
        agent-badge/           # Agent name + provider + model tier badge
        provider-icon/         # Anthropic/OpenAI provider logos
        trace-link/            # Clickable link to AWS X-Ray trace
      pipes/
        currency.pipe.ts       # EUR formatting per locale
        percentage.pipe.ts     # Percentage formatting per locale
        date-relative.pipe.ts  # "2 hours ago", "28 feb"
        tabular-nums.pipe.ts   # Tabular-lining numeric formatting
      directives/
        reduced-motion.directive.ts  # Respects prefers-reduced-motion
    index.ts                   # Public API
  project.json
```

### 3.2 Design Tokens as CSS Custom Properties

The design tokens from `shared.css` are ported directly to the component library as CSS custom properties, enabling theming:

```scss
// tokens/_colors.scss
:root {
  // Brand
  --nf-primary: #1B6B4A;
  --nf-primary-light: #E8F5EE;
  --nf-primary-dark: #0F4A30;
  --nf-accent: #2A9D6E;

  // Semantic
  --nf-positive: #059669;
  --nf-positive-light: #ECFDF5;
  --nf-cautionary: #D97706;
  --nf-cautionary-light: #FFFBEB;
  --nf-negative: #DC2626;
  --nf-negative-light: #FEF2F2;

  // Neutrals (full scale)
  --nf-neutral-50: #FAFBFC;
  --nf-neutral-100: #F3F4F6;
  --nf-neutral-200: #E5E7EB;
  --nf-neutral-300: #D1D5DB;
  --nf-neutral-400: #9CA3AF;
  --nf-neutral-500: #6B7280;
  --nf-neutral-600: #4B5563;
  --nf-neutral-700: #374151;
  --nf-neutral-800: #1F2937;
  --nf-neutral-900: #111827;
}

// Dark mode override
@media (prefers-color-scheme: dark) {
  :root {
    --nf-neutral-50: #111827;
    --nf-neutral-100: #1F2937;
    --nf-neutral-800: #F3F4F6;
    --nf-neutral-900: #FAFBFC;
    /* ... full dark palette ... */
  }
}
```

### 3.3 Key Components

| Component | Selector | Inputs | Wireframe Reference |
|---|---|---|---|
| `NfCard` | `<nf-card>` | `[accent]="boolean"` | `.card`, `.card-accent` |
| `NfButton` | `<button nf-button>` | `[variant]="'primary'\|'secondary'\|'outline'\|'danger'"`, `[full]="boolean"` | `.btn-*` |
| `NfBadge` | `<nf-badge>` | `[color]="'green'\|'amber'\|'red'\|'primary'"` | `.badge-pill` |
| `NfListItem` | `<nf-list-item>` | `[icon]`, `[title]`, `[subtitle]`, `[value]`, `[change]`, `[changeColor]` | `.list-item` |
| `NfExpandable` | `<nf-expandable>` | `[title]`, `[open]` | `.expandable` |
| `NfToggle` | `<nf-toggle>` | `[active]`, `(toggled)` | `.toggle` |
| `NfGauge` | `<nf-gauge>` | `[value]`, `[color]="'green'\|'amber'\|'primary'"` | `.gauge-track`, `.gauge-fill` |
| `NfStatusDot` | `<nf-status-dot>` | `[color]="'green'\|'amber'\|'red'"` | `.status-dot` |
| `NfNotifIcon` | `<nf-notif-icon>` | `[severity]="'info'\|'advisory'\|'impactful'\|'confirmable'\|'critical'"` | `.notif-icon` |
| `NfBottomTabs` | `<nf-bottom-tabs>` | `[tabs]`, `[active]`, `(tabChange)` | `.bottom-tabs` |
| `NfNavHeader` | `<nf-nav-header>` | `[title]`, `[showBack]`, `(back)` | `.nav-header` |
| `NfSkeleton` | `<nf-skeleton>` | `[width]`, `[height]`, `[shape]="'rect'\|'circle'"` | Skeleton loading |
| `NfGlossary` | `<nf-glossary>` | `[term]` | Dotted underline tooltip |
| `NfAgentBadge` | `<nf-agent-badge>` | `[agentName]`, `[provider]="'anthropic'\|'openai'"`, `[modelTier]` | Agent attribution pill (e.g., "Portfolio Analyst -- Claude Opus 4.6") |
| `NfProviderIcon` | `<nf-provider-icon>` | `[provider]="'anthropic'\|'openai'"`, `[size]="'sm'\|'md'"` | Anthropic/OpenAI logo SVG icon |
| `NfTraceLink` | `<nf-trace-link>` | `[traceId]`, `[region]` | Clickable link to AWS X-Ray trace console |

### 3.4 Responsive Breakpoints

```scss
// tokens/_breakpoints.scss
$breakpoint-mobile: 640px;
$breakpoint-tablet: 1024px;

@mixin mobile-only {
  @media (max-width: #{$breakpoint-mobile - 1px}) { @content; }
}
@mixin tablet {
  @media (min-width: $breakpoint-mobile) and (max-width: #{$breakpoint-tablet - 1px}) { @content; }
}
@mixin desktop {
  @media (min-width: $breakpoint-tablet) { @content; }
}
@mixin tablet-up {
  @media (min-width: $breakpoint-mobile) { @content; }
}
```

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile (primary) | < 640px | Single column, bottom tab bar, one question per screen in onboarding |
| Tablet | 640px -- 1024px | Two-column where appropriate, bottom tab bar |
| Desktop | > 1024px | Widened single column with sidebar navigation, grouped onboarding questions |

### 3.5 WCAG 2.1 AA Compliance

| Requirement | Implementation |
|---|---|
| Color contrast | All text meets 4.5:1 (body) / 3:1 (large text). Verified with design tokens. |
| Keyboard navigation | All interactive components support tab navigation with visible focus rings. |
| Touch targets | Minimum 44x44px tap targets enforced in component styles. |
| Screen readers | Semantic HTML, `aria-label` on charts and custom components, `role` attributes. |
| Font scaling | `rem`-based sizing, tested up to 200% system font scale. |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` disables all transitions/animations. |
| Status indicators | Color is never the sole indicator -- always paired with icon or text label. |

### 3.6 Typography

```scss
// tokens/_typography.scss
:root {
  --nf-font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text',
    'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --nf-font-size-xs: 0.6875rem;   // 11px
  --nf-font-size-sm: 0.8125rem;   // 13px
  --nf-font-size-base: 0.9375rem; // 15px
  --nf-font-size-md: 1rem;        // 16px
  --nf-font-size-lg: 1.125rem;    // 18px
  --nf-font-size-xl: 1.375rem;    // 22px
  --nf-font-size-2xl: 1.75rem;    // 28px
  --nf-font-size-3xl: 2.125rem;   // 34px
}
```

Financial data uses `font-variant-numeric: tabular-nums` to ensure column alignment.

---

## 4. Screen Implementation Plan

### 4.1 Phase 4 Screens (8 Screens)

Phase 4 targets 8 screens across all 3 MFE remotes plus the shell. These are ordered by user journey and prioritized for validating the core investor experience.

| # | Screen | MFE Remote | Primary BFF(s) | Key GraphQL Operations |
|---|---|---|---|---|
| 1 | Landing | Shell (local) | Static | None |
| 2 | Sign Up / Sign In | Shell (local) | Cognito | None |
| 3 | Onboarding (Chat UI) | `investor-mfe` | `investor-bff` | `recordOnboardingAnswer`, `setGoal`, `setRiskProfile`, `selectOperatingMode`, `grantMandate` |
| 4 | Dashboard (Home) | `portfolio-mfe` | `portfolio-bff`, `advisory-bff`, `investor-bff` | `getPortfolioSummary`, `getRecommendations`, `getUnreadCount` |
| 5 | Decision Detail ("Why?") | `advisory-mfe` | `advisory-bff` | `getExplanation`, `getRecommendation` |
| 6 | Confirmation Dialog | `advisory-mfe` | `advisory-bff` | `confirmDecision` |
| 7 | Notifications | `investor-mfe` | `investor-bff` | `getNotifications`, `markAsRead` |
| 8 | Settings & Profile | `investor-mfe` | `investor-bff` | `getProfile`, `editProfile` |

**Deferred screens** (Portfolio Detail, Deposit/Withdrawal, How Nestfolio Works, Account Closure) are tracked in `07-production-next-steps.md`. All Phase 4 screens are served from their respective MFE remotes.

### 4.2 Implementation Order (Phase 4)

Ordered by dependency -- each screen unlocks the next step in the user journey.

| Priority | Screen | MFE Remote | Rationale |
|---|---|---|---|
| 1 | Landing | Shell | Entry point. Mobile-first hero: "AI-managed investing, explained." Static content with CTA to sign up. |
| 2 | Sign Up / Sign In | Shell | Auth via Cognito hosted UI. Must work before any authenticated screen. |
| 3 | Onboarding (Chat UI) | `investor-mfe` | Creates investor profile, goals, risk tolerance, operating mode, mandate. **Conversational chat interface** is a primary UX differentiator (see 4.4 below). |
| 4 | Dashboard (Home) | `portfolio-mfe` | Post-onboarding landing. Portfolio value, status banner, recent activity, action-required card, simulation badge. |
| 5 | Decision Detail ("Why?") | `advisory-mfe` | Trust-building screen linked from dashboard. Agent attribution, risk impact visualization, audit trail. **Most complex single screen** (see 4.5 below). |
| 6 | Confirmation Dialog | `advisory-mfe` | User confirms or rejects AI recommendation. Optimistic UI with offline queuing. |
| 7 | Notifications | `investor-mfe` | Simple list of notifications with severity-based icons, mark-as-read, linking to decision detail. |
| 8 | Settings & Profile | `investor-mfe` | View/edit investor profile, locale preference, notification settings. |

### 4.3 Dashboard Composition Pattern

The Dashboard screen is the most complex because it aggregates data from three BFFs. In Phase 4, this is straightforward -- the `DashboardComponent` injects three services directly. In a later full microfrontend phase, the dashboard could be composed of embedded components from different MFEs:

```typescript
// Phase 4: single DashboardComponent in the shell
@Component({
  selector: 'app-dashboard',
  template: `
    <div class="greeting">
      <h1>Buongiorno, {{ userName() }}</h1>
    </div>
    <nf-card class="portfolio-card">
      <app-portfolio-value />    <!-- data from portfolio-bff -->
    </nf-card>
    <nf-card class="status-banner">
      <app-status-banner />      <!-- data from advisory-bff -->
    </nf-card>
    <nf-card class="activity-card">
      <app-recent-activity />    <!-- data from investor-bff -->
    </nf-card>
    @if (pendingConfirmation()) {
      <nf-card class="action-card">
        <app-action-required />  <!-- data from advisory-bff -->
      </nf-card>
    }
    <nf-bottom-tabs [tabs]="tabs" [active]="'home'" />
  `,
})
export class DashboardComponent { }
```

### 4.4 Onboarding Conversational Chat UI

The onboarding flow uses a **conversational chat interface** rather than a traditional multi-step form. This is more work than a standard form wizard but serves as a **major UX differentiator** -- it makes the onboarding feel personal and guided rather than bureaucratic.

**Key UX characteristics:**

- **Animated message bubbles** with typing indicators (three-dot animation before each bot message)
- **One question at a time** -- the user sees a single question with a dynamic input control (option buttons, slider, currency amount, mode selector, or consent toggle)
- **Progress indicator**: "Step X of 8" displayed at the top
- **Back navigation**: User can tap back to revisit and change a previous answer; the chat scrolls up and the input resets to the previous step
- **Sequential reveal**: Bot messages animate in one at a time with staggered delays (300ms typing indicator, then message slides in)
- **User responses appear as chat bubbles** on the right side, creating a conversation transcript

**Implementation approach:**

```typescript
// Onboarding conversation state machine
interface OnboardingStep {
  id: string;
  stepNumber: number;
  messages: ConversationMessage[];    // Bot messages to display sequentially
  inputType: 'options' | 'slider' | 'amount' | 'mode-selector' | 'consent' | 'none';
  options?: { value: string; label: string; icon?: string }[];
  sliderConfig?: { min: number; max: number; step: number; unit: string };
  validations?: ((value: unknown) => boolean)[];
  graphqlMutation: string;            // Mutation to call on answer
}

// Messages animate in sequentially with typing indicators
@Component({
  selector: 'app-onboarding-conversation',
  template: `
    <nf-nav-header title="Setup" [showBack]="currentStep() > 1" (back)="goBack()" />
    <div class="progress-bar">
      <div class="progress-fill" [style.width.%]="(currentStep() / totalSteps) * 100"></div>
      <span class="progress-label">Step {{ currentStep() }} of {{ totalSteps }}</span>
    </div>

    <div class="chat-area" #chatArea>
      @for (msg of visibleMessages(); track msg.id) {
        <div class="chat-bubble" [class.bot]="msg.sender === 'bot'"
             [class.user]="msg.sender === 'user'" [@slideIn]>
          {{ msg.text }}
        </div>
      }
      @if (isTyping()) {
        <div class="typing-indicator">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      }
    </div>

    <div class="input-area">
      @switch (currentInputType()) {
        @case ('options') {
          <div class="option-buttons">
            @for (opt of currentOptions(); track opt.value) {
              <button nf-button variant="outline" (click)="selectOption(opt)">
                @if (opt.icon) { <span class="opt-icon">{{ opt.icon }}</span> }
                {{ opt.label }}
              </button>
            }
          </div>
        }
        @case ('slider') {
          <nf-slider [config]="currentSliderConfig()" (valueChange)="onSliderChange($event)" />
          <button nf-button variant="primary" [full]="true" (click)="submitSliderValue()">Continue</button>
        }
        @case ('amount') {
          <nf-currency-input [(value)]="amountValue" />
          <button nf-button variant="primary" [full]="true" (click)="submitAmount()">Continue</button>
        }
        @case ('consent') {
          <nf-consent-card [text]="consentText()" (accepted)="onConsent($event)" />
        }
      }
    </div>
  `,
})
export class OnboardingConversationComponent { }
```

**Why this is complex (not a simple form):**

- Typing indicator animation timing and sequencing logic
- Smooth auto-scroll as new messages appear
- Back navigation that must unwind the chat state and re-display the previous input
- Dynamic input switching per step with different validation rules
- Mobile keyboard handling (input area must stay visible above keyboard)
- Accessibility: screen reader announcements for new messages, focus management on input changes

### 4.5 Decision Detail "Why?" Screen (Heavy Investment)

The Decision Detail screen is the **highest-complexity single screen** in Phase 4. It is the primary trust-building artifact -- the place where Nestfolio proves its AI decisions are transparent, auditable, and explainable. This screen is served from the `advisory-mfe` remote, validating Native Federation end-to-end.

**Component tree:**

```
DecisionDetailPage
  |-- NfNavHeader (back to dashboard/notifications)
  |-- DecisionHeadlineCard
  |     |-- headline text
  |     |-- NfAgentBadge (which agent made this decision)
  |     |-- reasoning summary paragraph
  |-- NfExpandable "Market Context"
  |     |-- market context paragraph
  |-- NfExpandable "Reasoning Factors"
  |     |-- NfListItem[] (factor name, description, weight)
  |-- NfExpandable "Risk Impact"
  |     |-- RiskImpactVisualization
  |           |-- NfGauge "Before" (prior portfolio risk score)
  |           |-- arrow indicator
  |           |-- NfGauge "After" (post-decision risk score)
  |           |-- delta label (+/- change)
  |-- NfExpandable "Trades Executed"
  |     |-- NfListItem[] (instrument, side, quantity, value)
  |-- NfExpandable "Cost & Impact"
  |     |-- fees, slippage, estimated tax impact
  |-- NfExpandable "Compliance"
  |     |-- NfBadge (PASS/FAIL)
  |     |-- guardrail check results
  |-- AuditFooter
        |-- Decision ID
        |-- Model versions (e.g., "Claude Opus 4.6", "GPT-4o-mini")
        |-- Prompt hash
        |-- NfTraceLink (link to X-Ray trace)
```

**Key sub-components:**

- **Agent attribution badges**: Each decision displays which AI agent(s) contributed, with provider and model tier. For example, `NfAgentBadge` shows "Portfolio Analyst -- Claude Opus 4.6" with the Anthropic provider icon.
- **Risk impact visualization**: Before/after gauge pair showing how the decision shifts the portfolio risk score. Uses `NfGauge` with color transitions (green/amber/red) based on risk band.
- **Audit footer**: Immutable reference data for compliance and debugging -- decision ID, model versions used, prompt template hashes, and a clickable link to the AWS X-Ray trace for the decision pipeline.

**Progressive disclosure pattern**: The headline card and agent badge are always visible (no scrolling needed for the "what" and "who"). All detail sections are collapsed by default. The user expands only what they care about.

```typescript
@Component({
  selector: 'app-decision-detail',
  template: `
    <nf-nav-header title="Decision Detail" [showBack]="true" (back)="navigateBack()" />

    <!-- Always visible: headline + agent + reasoning -->
    <nf-card>
      <h2>{{ explanation().headline }}</h2>
      <nf-agent-badge
        [agentName]="explanation().agentName"
        [provider]="explanation().provider"
        [modelTier]="explanation().modelId" />
      <p class="why-text">{{ explanation().reasoning }}</p>
    </nf-card>

    <!-- Expandable sections: collapsed by default -->
    <nf-expandable title="Market Context">
      <p>{{ explanation().marketContext }}</p>
    </nf-expandable>

    <nf-expandable title="Reasoning Factors">
      @for (factor of explanation().factors; track factor.name) {
        <nf-list-item [title]="factor.name" [subtitle]="factor.description"
          [value]="factor.weight | percent" />
      }
    </nf-expandable>

    <nf-expandable title="Risk Impact">
      <div class="risk-impact-viz">
        <nf-gauge [value]="explanation().priorRisk" label="Before"
          [color]="riskColor(explanation().priorRisk)" />
        <span class="risk-arrow">→</span>
        <nf-gauge [value]="explanation().postRisk" label="After"
          [color]="riskColor(explanation().postRisk)" />
      </div>
      <p class="risk-delta">
        {{ explanation().postRisk - explanation().priorRisk | number:'1.1-1' }} risk score change
      </p>
    </nf-expandable>

    <nf-expandable title="Trades Executed">
      @for (trade of explanation().trades; track trade.instrument) {
        <nf-list-item [title]="trade.instrument" [subtitle]="trade.side"
          [value]="trade.value | nfCurrency" />
      }
    </nf-expandable>

    <nf-expandable title="Cost & Impact">
      <nf-list-item title="Transaction fees" [value]="explanation().fees | nfCurrency" />
      <nf-list-item title="Estimated slippage" [value]="explanation().slippage | nfCurrency" />
      <nf-list-item title="Tax impact" [value]="explanation().taxImpact | nfCurrency" />
    </nf-expandable>

    <nf-expandable title="Compliance">
      <nf-badge [color]="explanation().complianceStatus === 'pass' ? 'green' : 'red'">
        {{ explanation().complianceStatus | uppercase }}
      </nf-badge>
      @for (check of explanation().guardrailChecks; track check.rule) {
        <nf-list-item [title]="check.rule" [subtitle]="check.result" />
      }
    </nf-expandable>

    <!-- Audit footer: always visible at bottom -->
    <div class="audit-footer">
      <p class="audit-line">Decision ID: <code>{{ explanation().decisionId }}</code></p>
      <p class="audit-line">Models: {{ explanation().modelVersions.join(', ') }}</p>
      <p class="audit-line">Prompt hash: <code>{{ explanation().promptHash }}</code></p>
      <nf-trace-link [traceId]="explanation().xrayTraceId" />
    </div>
  `,
})
export class DecisionDetailComponent { }
```

**Why this is complex:**

- Agent badge component with provider icon resolution and model tier display
- Risk impact before/after gauge visualization with color transitions and delta calculations
- Audit footer with formatted trace links (deep link to X-Ray console)
- Multiple expandable sections each with different content layouts
- Data aggregation from advisory-bff (explanation, trades, compliance) into a single view
- Responsive layout: single-column mobile, wider content area on tablet/desktop

---

## 5. Internationalization (i18n)

### 5.1 Approach: Angular built-in i18n + runtime translation service

**Recommendation: `@angular/localize` + `ngx-translate`** (hybrid approach).

- `@angular/localize` for compile-time extraction and structural i18n (plurals, ICU expressions)
- `ngx-translate` for runtime language switching without full rebuild (important for UX -- users can switch language in Settings without page reload)

In practice for Phase 4 with only two locales (`it-IT`, `en-GB`), `ngx-translate` alone is sufficient and simpler.

### 5.2 Default Locale: `it-IT`

The application loads with Italian as the default. Locale resolution order:

1. User preference (stored in Settings, persisted to `investor-bff`)
2. Browser locale (`navigator.language`)
3. Default: `it-IT`

### 5.3 String Externalization

```json
// assets/i18n/it-IT.json
{
  "dashboard": {
    "greeting": "Buongiorno, {{name}}",
    "portfolioValue": "Valore del portafoglio",
    "statusOnTrack": "Il tuo portafoglio e' in linea con i tuoi obiettivi",
    "noActionNeeded": "Nessuna azione richiesta",
    "lastCheck": "Ultimo controllo: {{time}}",
    "recentActivity": "Attivita' recente",
    "seeAll": "Vedi tutta l'attivita'",
    "confirmationNeeded": "La tua conferma e' necessaria"
  },
  "periods": {
    "1W": "1S",
    "1M": "1M",
    "3M": "3M",
    "6M": "6M",
    "YTD": "YTD",
    "1Y": "1A",
    "ALL": "Tutto"
  }
}
```

### 5.4 Number/Date/Percentage Formatting

```typescript
// libs/i18n/src/formatters.ts
@Injectable({ providedIn: 'root' })
export class LocaleFormatterService {
  private locale = inject(TenantContextService).locale;

  formatCurrency(value: number): string {
    return new Intl.NumberFormat(this.locale(), {
      style: 'currency',
      currency: 'EUR',
    }).format(value);
    // it-IT: "EUR 1.234,56" or "1.234,56 EUR"
    // en-GB: "EUR1,234.56"
  }

  formatPercentage(value: number): string {
    return new Intl.NumberFormat(this.locale(), {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value / 100);
    // it-IT: "3,2%"
    // en-GB: "3.2%"
  }

  formatDate(date: Date | string): string {
    return new Intl.DateTimeFormat(this.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(date));
    // it-IT: "28 feb 2026"
    // en-GB: "28 Feb 2026"
  }
}
```

### 5.5 Tone Localization

| Context | Italian Register | Example |
|---|---|---|
| Legal / mandate copy | Formal "Lei" | "Lei autorizza Nestfolio a gestire il suo portafoglio..." |
| Onboarding conversation | Informal "tu" | "Per cosa stai risparmiando?" |
| Dashboard / explanations | Informal "tu" | "Il tuo portafoglio e' in linea con i tuoi obiettivi" |
| Error messages | Neutral/impersonal | "Si e' verificato un problema temporaneo..." |

Translation files include tone annotations as comments to guide translators.

---

## 6. Cognito Integration

### 6.1 Sign Up / Sign In Flow

```
User lands on nestfolio.app/landing
  |
  +-- Taps "Sign Up" or "Sign In"
  |
  +-- Redirected to Cognito Hosted UI
  |     (Google federation, Facebook federation, email+password)
  |
  +-- Cognito authenticates, returns authorization code
  |
  +-- Shell exchanges code for tokens (idToken, accessToken, refreshToken)
  |
  +-- Shell decodes idToken, extracts:
  |     - sub (userId)
  |     - custom:tenantId
  |     - email
  |     - name
  |
  +-- If new user (no onboarding completed):
  |     redirect to /onboarding
  |
  +-- If existing user:
        redirect to /dashboard
```

### 6.2 Cognito Hosted UI vs Custom UI

**Recommendation: Cognito Hosted UI** for Phase 4.

| Factor | Hosted UI | Custom UI |
|---|---|---|
| Development effort | Zero -- Cognito handles everything | Significant -- build login forms, handle federation flows |
| Social federation | Built-in | Must integrate each provider SDK |
| Security | Cognito manages PKCE, CSRF | Must implement correctly |
| Branding | Limited customization (CSS) | Full control |
| UX polish | Adequate for Phase 4 | Better for Phase 2+ |

In a later phase, consider switching to a custom UI using `@aws-amplify/auth` for a fully branded experience.

### 6.3 JWT Token Management

```typescript
// libs/auth/src/auth.service.ts
@Injectable({ providedIn: 'root' })
export class AuthService {
  private _isAuthenticated = signal(false);
  private _user = signal<UserProfile | null>(null);

  readonly isAuthenticated = this._isAuthenticated.asReadonly();
  readonly user = this._user.asReadonly();

  async initialize(): Promise<void> {
    try {
      const session = await fetchAuthSession();
      if (session.tokens) {
        const idToken = session.tokens.idToken;
        this._isAuthenticated.set(true);
        this._user.set({
          userId: idToken.payload.sub,
          tenantId: idToken.payload['custom:tenantId'],
          email: idToken.payload.email,
          name: idToken.payload.name,
        });
        // Push to shared state
        this.tenantContext.setAuthContext(idToken);
      }
    } catch {
      this._isAuthenticated.set(false);
    }
  }

  async getAccessToken(): Promise<string> {
    const session = await fetchAuthSession({ forceRefresh: false });
    return session.tokens?.accessToken?.toString() ?? '';
  }

  async signOut(): Promise<void> {
    await signOut();
    this._isAuthenticated.set(false);
    this._user.set(null);
  }
}
```

### 6.4 Session Handling

- Tokens are stored in browser memory (Amplify default) -- not localStorage for security
- Refresh tokens have a 30-day expiry (configurable in Cognito)
- Access tokens refresh automatically via Amplify when they expire (default 1 hour)
- On 401 from AppSync, the auth interceptor triggers a token refresh attempt; if that fails, redirect to login
- Tab/window focus event triggers a session validity check

---

## 7. Phase 4 vs Later Phase Frontend Scope

### 7.1 Phase 4 -- Prototype (6 Screens)

**Goal**: Functional prototype validating the core investor experience with simulated data. No real capital, no real broker. Shipped as PWA (installed via "Add to Home Screen"). `advisory-mfe` deployed as a Native Federation remote to validate the microfrontend pattern.

| Screen | Phase 4 Status | Data Source |
|---|---|---|
| Landing | Functional | Static |
| Sign Up / Sign In | Functional (Cognito) | Real auth |
| Onboarding (Chat UI) | Functional | Real BFF (investor-bff) |
| Dashboard | Functional | Simulated portfolio data from portfolio-bff (seeded positions) |
| Decision Detail ("Why?") | Functional (advisory-mfe remote) | Seeded decisions from advisory-ctrl |
| Notifications | Functional | Real notification pipeline (investor-ctrl) |
| Portfolio Detail | **Deferred** | Tracked in `07-production-next-steps.md` |
| Settings | **Deferred** | Tracked in `07-production-next-steps.md` |
| Confirmation Dialog | **Deferred** | Not needed until real decisions exist |
| Deposit / Withdrawal | **Deferred** | No real capital in simulation |
| How Nestfolio Works | **Deferred** | Lower priority |
| Account Closure | **Deferred** | Not needed for prototype |

### 7.2 Seed Data Strategy for Phase 4

- `portfolio-bff` serves simulated portfolio projections seeded from historical market data replay
- `advisory-ctrl` generates decisions against simulated portfolios -- real agent invocations, simulated execution
- `investor-ctrl` generates real notifications from simulated events
- No mock API layer on the frontend -- the backend itself produces realistic simulated data
- Seed data script creates test investor profiles with various goals, risk profiles, and operating modes
- Dashboard displays a **simulation badge** indicating data is simulated

### 7.3 Later Phases -- IBKR Sandbox & Beyond

**Additions**:

- Portfolio Detail (4 tabs, charts, holdings)
- Settings & Profile
- Confirmation Dialog (real Level 2 decisions)
- Deposit/Withdrawal flows (real IBKR sandbox)
- Real portfolio positions from IBKR sandbox API
- Real order execution through IBKR paper trading
- Account Closure flow
- How Nestfolio Works screen
- Remaining MFE remotes (`portfolio-mfe`, `investor-mfe`) split from the shell

---

## 8. Deferred Frontend Scope

The following screens and capabilities are deferred to later phases. See `07-production-next-steps.md` for details.

| Component | Phase |
|---|---|
| Portfolio Detail (4 tabs, charts, holdings) | Post-Phase 4 |
| Settings & Profile | Post-Phase 4 |
| Confirmation Dialog | Post-Phase 4 |
| Deposit / Withdrawal flows | Post-Phase 4 |
| How Nestfolio Works | Post-Phase 4 |
| Account Closure & GDPR | Post-Phase 4 |
| Dark mode support | Post-Phase 4 |
| en-GB translations | Post-Phase 4 |
| Remaining microfrontend remotes (portfolio-mfe, investor-mfe) | Post-Phase 4 |
