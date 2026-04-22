# Host shell — logout control — design

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-22
**Blocks:** [Playwright UI e2e](./2026-04-22-playwright-e2e-ui-design.md) Phase 1 journey step 11

## Why this spec exists

The Playwright spec's 2026-04-22 survey found a logout control is **absent** from every shell-level component (`ShellLayoutComponent`, `HeaderComponent`, `SidebarComponent`, `BottomNavComponent`, host `app.component.ts`). The plumbing underneath already exists:

- `libs/shell/src/logout-orchestrator.ts` — registry that resets all opted-in signal stores.
- `libs/shell/src/features/with-logout-reset.ts` — the store feature that registers with the orchestrator. Already consumed by `AuthStore`, `dashboard.store.ts`, `notification.store.ts`.
- `libs/shell/src/auth/auth.service.ts:55-57` — `authSignOut()` wraps Amplify's `signOut()`.
- `libs/shell/src/stores/auth.store.ts:45-51` — `AuthStore.logout()` resets state and calls `logoutOrchestrator.resetAll()`.
- `apps/nestfolio-host/src/app/app.routes.ts:16` — `/login` route exists on the host.

What's missing is a **button** that ties them together. This is the smallest of the three prerequisite specs, as noted in the parent spec.

## Goals

- Place a visible, accessible logout control in the host shell, reachable from every authenticated page.
- Wire it to the existing Amplify sign-out + orchestrator reset + `/login` redirect flow.
- Make it testable by the Playwright journey (stable `data-testid`).
- Respect the existing `libs/shell` / `libs/ui` dependency boundary.

## Non-goals

- Session-timeout UI, "log out from all devices", account-switcher UI, or any auth surface beyond a single logout action.
- Restructuring `HeaderComponent`, `ShellLayoutComponent`, or the host shell template beyond the minimum content-projection slot needed.
- A new top-level "account menu" with avatar + dropdown. The Playwright journey needs only a callable logout control; a menu is a future UX polish pass.
- Changes to `LogoutOrchestrator` or any `withLogoutReset`-registered store. The wiring is already correct.

## High-level decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Component location | `libs/shell` (new `LogoutButtonComponent`) | Logout is an auth action. `libs/shell` already owns `auth.service.ts`, `AuthStore`, and `LogoutOrchestrator`. `libs/ui` must not depend on `libs/shell` (peer libs, no existing cross-import). |
| Placement | Header actions slot via named content projection from `ShellLayoutComponent` | `HeaderComponent` already exposes `<ng-content/>` inside `.nf-header-actions`. `ShellLayoutComponent` must forward a named slot so consumers can project into the header. |
| Host composition | Host `app.component.ts` projects `LogoutButtonComponent` into the shell-layout's header slot | Keeps `libs/ui` dependency-free; the host owns the composition. |
| Confirmation dialog | None in Phase 1 | Minimum viable — one click logs out. PrimeNG `p-confirmDialog` is a future polish item if product requests it. |
| Error handling | Fail-safe local reset | If `Amplify.signOut()` throws, still call `AuthStore.logout()` (clears local tokens) and redirect. Never strand the user in a half-logged-out state. |
| Post-logout route | `/login` | Matches the existing auth-guard redirect (`libs/shell/src/auth/auth.guard.ts:15`) and interceptor behavior. |

## Architecture

### 1. New `LogoutButtonComponent` — `libs/shell/src/components/logout-button.component.ts`

Standalone Angular component, injectable anywhere. PrimeNG `p-button` with an `i` icon (`pi pi-sign-out`).

**Template:**
```html
<button
  class="nf-logout-btn"
  type="button"
  [attr.data-testid]="'cta-logout'"
  (click)="logout()"
  aria-label="Log out"
>
  <i class="pi pi-sign-out" aria-hidden="true"></i>
  <span class="nf-logout-label">Log out</span>
</button>
```

**Click handler:**
```ts
async logout(): Promise<void> {
  try {
    await authSignOut();           // Amplify sign-out; may throw on network failure
  } catch {
    // Fail-safe: still clear local state even if Amplify call failed.
  } finally {
    this.authStore.logout();       // resets AuthStore + triggers orchestrator.resetAll()
    await this.router.navigate(['/login']);
  }
}
```

**Responsive display**: full label on ≥768px, icon-only on narrower breakpoints. Matches the existing responsive patterns used by `ShellLayoutComponent` (bottom-nav on mobile, sidebar on desktop).

**Export**: re-export via `libs/shell/src/index.ts` alongside the existing surface.

### 2. Named content projection on `ShellLayoutComponent`

`libs/ui/src/layout/shell-layout.component.ts` currently passes no content to `<nf-header>`. Add a named-slot projection:

**Template change:**
```html
<nf-header
  [title]="title()"
  [showMenuToggle]="true"
  (menuToggle)="sidebarCollapsed = !sidebarCollapsed"
>
  <ng-content select="[nfHeaderActions]" />
</nf-header>
<div class="shell-body">
  ...
  <main class="shell-content">
    <ng-content />   <!-- unchanged default slot -->
  </main>
</div>
```

No template logic change elsewhere. `HeaderComponent`'s existing `<ng-content/>` inside `.nf-header-actions` receives whatever consumers project under the `nfHeaderActions` selector.

**Backwards compatibility**: consumers who don't project anything get the same rendering as today (empty header actions). Default `<ng-content/>` slot for the main body is unchanged — existing call sites continue to work.

### 3. Host composition — `apps/nestfolio-host/src/app/app.component.ts`

Current template:
```html
<app-system-banner />
<nf-shell-layout>
  <router-outlet />
</nf-shell-layout>
```

Updated:
```html
<app-system-banner />
<nf-shell-layout>
  @if (authStore.status() === 'authenticated') {
    <nf-logout-button nfHeaderActions />
  }
  <router-outlet />
</nf-shell-layout>
```

Gated on `authStore.status() === 'authenticated'` so the button doesn't appear on `/login`, `/signup`, or `/confirm` pages. `AuthStore` is already injected in `AppComponent`.

Adds one import: `LogoutButtonComponent` from `@nestfolio/shell`.

### 4. AuthStore lifecycle note (no change required)

`AuthStore.logout()` at `libs/shell/src/stores/auth.store.ts:48-51` already performs the full local cleanup:
- `patchState(store, { ...initialState, status: 'unauthenticated' })`.
- `logoutOrchestrator.resetAll()` — iterates every store that registered via `withLogoutReset` (confirmed callers: `dashboard.store.ts:150`, `notification.store.ts:8`).

The LogoutButton component does not touch individual stores. The orchestrator is authoritative.

## Testing

### Unit test — `libs/shell/test/components/logout-button.component.spec.ts` (new)

- Button renders with `data-testid="cta-logout"`.
- Click calls `authSignOut()` (mocked), then `AuthStore.logout()` (spy), then `router.navigate(['/login'])` (spy).
- If `authSignOut()` rejects, `AuthStore.logout()` still runs and navigation still happens (fail-safe).
- `aria-label` is "Log out".

Uses the existing Amplify auth mock pattern (`jest.mock('aws-amplify/auth')` — same as `libs/shell/test/auth/auth.service.test.ts`).

### Unit test — `libs/ui/test/layout/shell-layout.component.spec.ts` (extend)

- Projecting a dummy element with the `nfHeaderActions` attribute renders it inside the header's actions area.
- Default projection still renders inside `.shell-content`.

### Host test — `apps/nestfolio-host/test/app.component.spec.ts` (extend)

- Logout button visible when `AuthStore.status() === 'authenticated'`.
- Logout button hidden when `AuthStore.status() === 'unauthenticated'`.

### Playwright journey — step 11 (parent spec)

Step 11 now becomes:
- After step 10 (accept advisory decision), assert `cta-logout` visible in the header.
- Click `cta-logout`.
- Assert URL navigates to `/login`.
- Assert `AuthStore.status()` cannot be observed directly — verify via UI: the host renders the login form and no shell chrome (the auth guard redirects any protected path back to `/login`).
- No assertion on orchestrator reset at the journey level — covered by unit tests.

## Acceptance criteria

- [ ] `LogoutButtonComponent` exists in `libs/shell/src/components/`, exported via the library index.
- [ ] `ShellLayoutComponent` exposes a `nfHeaderActions` named content-projection slot that forwards into `HeaderComponent`'s actions area.
- [ ] Host `app.component.ts` projects `LogoutButtonComponent` conditionally on `authStore.status() === 'authenticated'`.
- [ ] Click on the button: calls `authSignOut()` → calls `AuthStore.logout()` → redirects to `/login`.
- [ ] Fail-safe: network error from Amplify does not prevent local state reset or redirect.
- [ ] Button is hidden on `/login`, `/signup`, `/confirm`.
- [ ] Responsive: label + icon on desktop, icon-only on mobile.
- [ ] Unit tests green for `LogoutButtonComponent`, the shell-layout projection slot, and the host gating.
- [ ] Playwright journey step 11 clicks the button, lands on `/login`, and the protected-route guard prevents back-navigation to `/dashboard`.

## Open questions / plan-level decisions

- **Confirmation dialog (YAGNI in Phase 1)**: the plan may add a `p-confirmDialog` wrapper if product requests it later. Adds one roundtrip and a test-id (`cta-logout-confirm`). Not in Phase 1 scope.
- **Placement on mobile**: `BottomNavComponent` is the mobile primary-nav surface. Logout is an infrequent action, so keeping it in the header (icon-only on mobile) is acceptable. Revisit if product wants it in a menu.
- **Icon family**: PrimeNG `pi pi-sign-out` is the default; if the app adopts a different icon set, update alongside any other header icons.
- **Token revocation**: `Amplify.signOut()` revokes the Cognito refresh token if the User Pool client is configured to allow it. The repo's current client config (`services/investor/investor-web/src/service.stack.ts:79-82`) does not explicitly enable token revocation — acceptable for Phase 1. If stricter session hygiene becomes required, enable `enableTokenRevocation` on the user pool client; not in this spec.

## References

- Parent spec: [Playwright UI e2e — design](./2026-04-22-playwright-e2e-ui-design.md), §"Survey results (2026-04-22)" (step 11) and §"Steps" (step 11 descoped note).
- Existing primitives:
  - `libs/shell/src/logout-orchestrator.ts`
  - `libs/shell/src/features/with-logout-reset.ts`
  - `libs/shell/src/auth/auth.service.ts:55-57` (`authSignOut`)
  - `libs/shell/src/stores/auth.store.ts:45-51` (`AuthStore.logout`)
- Existing layout surface:
  - `libs/ui/src/layout/shell-layout.component.ts`
  - `libs/ui/src/layout/header.component.ts` (actions slot already exists at `.nf-header-actions`)
- Existing target route: `apps/nestfolio-host/src/app/app.routes.ts:16` (`/login`).
- Existing orchestrator consumers (proof the reset pipeline works):
  - `apps/dashboard-mfe/src/app/stores/dashboard.store.ts:150`
  - `apps/investor-mfe/src/app/stores/notification.store.ts:8`
