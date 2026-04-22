# Host shell — logout control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible, accessible logout button in the host shell header that calls Amplify sign-out, resets all opted-in stores via `LogoutOrchestrator`, and redirects to `/login` — fail-safe on network errors.

**Architecture:** New standalone `LogoutButtonComponent` in `libs/shell/src/components/`. `ShellLayoutComponent` in `libs/ui` gains a named content-projection slot (`[nfHeaderActions]`) that forwards into `HeaderComponent`'s existing actions area. Host `AppComponent` composes the two, gated on `authStore.status() === 'authenticated'` so the button is hidden on `/login`, `/signup`, `/confirm`.

**Tech Stack:** Angular 20 standalone components, PrimeNG (`p-button`, `pi pi-sign-out`), NgRx Signals (`AuthStore`), Jest with jsdom, `aws-amplify/auth`. `libs/shell` depends on `libs/ui`, never the reverse.

**Spec:** `docs/superpowers/specs/2026-04-22-host-shell-logout-control-design.md`

---

## File Structure

**Files to create**
- `libs/shell/src/components/logout-button.component.ts` — standalone `LogoutButtonComponent`; injects `AuthStore` + `Router`, wraps `authSignOut()`, handles fail-safe path.
- `libs/shell/test/components/logout-button.component.spec.ts` — unit tests for render + click flow + fail-safe.

**Files to modify**
- `libs/shell/src/index.ts` — re-export `LogoutButtonComponent`.
- `libs/ui/src/layout/shell-layout.component.ts` — add `<ng-content select="[nfHeaderActions]" />` inside the `<nf-header>` element; default main-body `<ng-content/>` stays unchanged.
- `libs/ui/test/layout/shell-layout.component.spec.ts` — NEW FILE (does not exist today). Tests default slot and named `[nfHeaderActions]` projection.
- `apps/nestfolio-host/src/app/app.component.ts` — import `LogoutButtonComponent`, project it with `@if (authStore.status() === 'authenticated')` gate.
- `apps/nestfolio-host/test/app/app.component.spec.ts` — add gating assertions (visible when authenticated, hidden when not).

**Files that stay untouched**
- `libs/shell/src/logout-orchestrator.ts` — already correct.
- `libs/shell/src/stores/auth.store.ts` — `logout()` already performs orchestrator.resetAll().
- `libs/shell/src/auth/auth.service.ts` — `authSignOut()` already exported.
- `libs/ui/src/layout/header.component.ts` — already has `<ng-content/>` inside `.nf-header-actions`.

---

## Task 1: Add `LogoutButtonComponent` (failing test first)

**Files:**
- Create: `libs/shell/src/components/logout-button.component.ts`
- Test:   `libs/shell/test/components/logout-button.component.spec.ts`

- [ ] **Step 1: Create the test directory and write the failing test file**

Create `libs/shell/test/components/logout-button.component.spec.ts`:

```ts
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { LogoutButtonComponent } from '../../src/components/logout-button.component';
import { AuthStore } from '../../src/stores/auth.store';

const mockSignOut = jest.fn();
jest.mock('aws-amplify/auth', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

describe('LogoutButtonComponent', () => {
  let fixture: ComponentFixture<LogoutButtonComponent>;
  let component: LogoutButtonComponent;
  let authStore: InstanceType<typeof AuthStore>;
  let routerNavigateSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockSignOut.mockReset();
    await TestBed.configureTestingModule({
      imports: [LogoutButtonComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LogoutButtonComponent);
    component = fixture.componentInstance;
    authStore = TestBed.inject(AuthStore);
    const router = TestBed.inject(Router);
    routerNavigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  it('renders the logout button with data-testid="cta-logout"', () => {
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]');
    expect(btn).toBeTruthy();
  });

  it('renders aria-label="Log out"', () => {
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Log out');
  });

  it('renders the pi pi-sign-out icon', () => {
    const icon = fixture.nativeElement.querySelector('.pi.pi-sign-out');
    expect(icon).toBeTruthy();
  });

  it('calls authSignOut, AuthStore.logout, and navigates to /login on click', async () => {
    mockSignOut.mockResolvedValue(undefined);
    const storeLogoutSpy = jest.spyOn(authStore, 'logout');
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]') as HTMLButtonElement;

    btn.click();
    await fixture.whenStable();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(storeLogoutSpy).toHaveBeenCalledTimes(1);
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('still runs AuthStore.logout and navigates when Amplify signOut rejects (fail-safe)', async () => {
    mockSignOut.mockRejectedValue(new Error('network down'));
    const storeLogoutSpy = jest.spyOn(authStore, 'logout');
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]') as HTMLButtonElement;

    btn.click();
    await fixture.whenStable();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(storeLogoutSpy).toHaveBeenCalledTimes(1);
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/login']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm nx test shell --testPathPattern=logout-button`

Expected: FAIL — "Cannot find module '../../src/components/logout-button.component'".

- [ ] **Step 3: Write the component implementation**

Create `libs/shell/src/components/logout-button.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthStore } from '../stores/auth.store';
import { authSignOut } from '../auth/auth.service';

@Component({
  selector: 'nf-logout-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      class="nf-logout-btn"
      type="button"
      data-testid="cta-logout"
      aria-label="Log out"
      (click)="logout()"
    >
      <i class="pi pi-sign-out" aria-hidden="true"></i>
      <span class="nf-logout-label">Log out</span>
    </button>
  `,
  styles: [`
    .nf-logout-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: transparent;
      border: 1px solid var(--p-surface-300);
      border-radius: 4px;
      padding: 0.35rem 0.75rem;
      cursor: pointer;
      color: var(--p-text-color);
      font-size: 0.875rem;
    }
    .nf-logout-btn:hover {
      background: var(--p-surface-100);
    }
    .nf-logout-label {
      display: none;
    }
    @media (min-width: 768px) {
      .nf-logout-label {
        display: inline;
      }
    }
  `],
})
export class LogoutButtonComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  async logout(): Promise<void> {
    try {
      await authSignOut();
    } catch {
      // Fail-safe: still clear local state + navigate even if Amplify rejects.
    } finally {
      this.authStore.logout();
      await this.router.navigate(['/login']);
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm nx test shell --testPathPattern=logout-button`

Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Commit**

```bash
git add libs/shell/src/components/logout-button.component.ts libs/shell/test/components/logout-button.component.spec.ts
git commit -m "feat(shell): add LogoutButtonComponent with fail-safe sign-out"
```

---

## Task 2: Re-export `LogoutButtonComponent` from `libs/shell`

**Files:**
- Modify: `libs/shell/src/index.ts`

- [ ] **Step 1: Add the export**

Edit `libs/shell/src/index.ts`. After the existing `SystemBannerComponent` export line, add:

```ts
export { LogoutButtonComponent } from './components/logout-button.component';
```

Full file after edit should end with:

```ts
export { SystemBannerComponent } from './components/system-banner.component';
export { LogoutButtonComponent } from './components/logout-button.component';
```

- [ ] **Step 2: Verify the library builds**

Run: `pnpm nx lint shell && pnpm nx test shell --testPathPattern=logout-button`

Expected: lint PASS, tests PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/shell/src/index.ts
git commit -m "feat(shell): export LogoutButtonComponent from public index"
```

---

## Task 3: Add `[nfHeaderActions]` named slot to `ShellLayoutComponent` — failing test first

**Files:**
- Create: `libs/ui/test/layout/shell-layout.component.spec.ts`
- Modify: `libs/ui/src/layout/shell-layout.component.ts`

- [ ] **Step 1: Write the failing spec for the named projection**

Create `libs/ui/test/layout/shell-layout.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ShellLayoutComponent } from '../../src/layout/shell-layout.component';

@Component({
  standalone: true,
  imports: [ShellLayoutComponent],
  template: `
    <nf-shell-layout>
      <button nfHeaderActions data-testid="projected-action">Go</button>
      <div data-testid="projected-body">body content</div>
    </nf-shell-layout>
  `,
})
class HostComponent {}

describe('ShellLayoutComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('projects [nfHeaderActions] content into the header actions area', () => {
    const header = fixture.nativeElement.querySelector('.nf-header-actions');
    expect(header).toBeTruthy();
    const action = header.querySelector('[data-testid="projected-action"]');
    expect(action).toBeTruthy();
  });

  it('projects default (unslotted) content into the main shell body', () => {
    const main = fixture.nativeElement.querySelector('.shell-content');
    expect(main).toBeTruthy();
    const body = main.querySelector('[data-testid="projected-body"]');
    expect(body).toBeTruthy();
  });

  it('does not leak the named-slot element into the main shell body', () => {
    const main = fixture.nativeElement.querySelector('.shell-content');
    expect(main.querySelector('[data-testid="projected-action"]')).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run the spec and confirm it fails**

Run: `pnpm nx test ui --testPathPattern=shell-layout`

Expected: FAIL — the `[nfHeaderActions]` button is not projected anywhere because the template has no matching `<ng-content select="...">`.

- [ ] **Step 3: Add the named-slot projection to the shell layout template**

Edit `libs/ui/src/layout/shell-layout.component.ts`. Replace the `<nf-header>` self-closing tag with a paired tag containing a named `<ng-content>`. The existing default `<ng-content />` inside `<main class="shell-content">` stays unchanged.

Change the template block from:

```ts
  template: `
    <div class="shell-layout" [class.sidebar-collapsed]="sidebarCollapsed">
      <nf-header
        [title]="title()"
        [showMenuToggle]="true"
        (menuToggle)="sidebarCollapsed = !sidebarCollapsed"
      />
      <div class="shell-body">
        <nf-sidebar
          [items]="navItems()"
          [collapsed]="sidebarCollapsed"
          class="shell-sidebar"
        />
        <main class="shell-content">
          <ng-content />
        </main>
      </div>
      <nf-bottom-nav [items]="navItems()" class="shell-bottom-nav" />
    </div>
  `,
```

To:

```ts
  template: `
    <div class="shell-layout" [class.sidebar-collapsed]="sidebarCollapsed">
      <nf-header
        [title]="title()"
        [showMenuToggle]="true"
        (menuToggle)="sidebarCollapsed = !sidebarCollapsed"
      >
        <ng-content select="[nfHeaderActions]" />
      </nf-header>
      <div class="shell-body">
        <nf-sidebar
          [items]="navItems()"
          [collapsed]="sidebarCollapsed"
          class="shell-sidebar"
        />
        <main class="shell-content">
          <ng-content />
        </main>
      </div>
      <nf-bottom-nav [items]="navItems()" class="shell-bottom-nav" />
    </div>
  `,
```

Nothing else changes in this file. No `styles`, no class members, no imports.

- [ ] **Step 4: Run the spec and confirm it passes**

Run: `pnpm nx test ui --testPathPattern=shell-layout`

Expected: PASS — all 3 assertions green.

- [ ] **Step 5: Run the full `ui` lib test suite to catch regressions**

Run: `pnpm nx test ui`

Expected: PASS — the existing `HeaderComponent`, `SidebarComponent`, `BottomNavComponent` specs still pass.

- [ ] **Step 6: Commit**

```bash
git add libs/ui/src/layout/shell-layout.component.ts libs/ui/test/layout/shell-layout.component.spec.ts
git commit -m "feat(ui): add [nfHeaderActions] named slot on ShellLayoutComponent"
```

---

## Task 4: Compose `LogoutButtonComponent` into the host shell

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.component.ts`
- Modify: `apps/nestfolio-host/test/app/app.component.spec.ts`

- [ ] **Step 1: Extend the host spec with gating assertions (failing)**

Replace the entire contents of `apps/nestfolio-host/test/app/app.component.spec.ts` with:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { AppComponent } from '../../src/app/app.component';
import { AuthStore } from '@nestfolio/shell';

jest.mock('@nestfolio/shell/auth', () => ({
  getAuthUser: jest.fn().mockResolvedValue(null),
  authGuard: () => true,
  authSignOut: jest.fn().mockResolvedValue(undefined),
}));

describe('AppComponent (lightweight)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [provideRouter([])],
      teardown: { destroyAfterEach: false },
    })
      .overrideComponent(AppComponent, {
        set: {
          imports: [CommonModule, RouterOutlet],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should have authStore injected', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.authStore).toBeDefined();
  });

  it('should not have ngOnInit (auth moved to APP_INITIALIZER)', () => {
    const fixture = TestBed.createComponent(AppComponent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((fixture.componentInstance as any).ngOnInit).toBeUndefined();
  });
});

describe('AppComponent logout gating', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [provideRouter([])],
      teardown: { destroyAfterEach: false },
    }).compileComponents();
  });

  it('renders cta-logout when AuthStore.status() === "authenticated"', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'u-1',
      username: 'tester',
      email: 't@example.com',
      tenantId: 't-1',
    } as never);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]');
    expect(btn).toBeTruthy();
  });

  it('does NOT render cta-logout when AuthStore.status() !== "authenticated"', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const authStore = TestBed.inject(AuthStore);
    authStore.setUnauthenticated();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]');
    expect(btn).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run the host spec and confirm the new gating assertions fail**

Run: `pnpm nx test nestfolio-host --testPathPattern=app.component`

Expected: the two new `AppComponent logout gating` tests FAIL because `AppComponent`'s template does not yet render `LogoutButtonComponent`.

- [ ] **Step 3: Update `AppComponent` to compose the logout button**

Edit `apps/nestfolio-host/src/app/app.component.ts`. Replace the whole file with:

```ts
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellLayoutComponent } from '@nestfolio/ui';
import { AuthStore, LogoutButtonComponent, SystemBannerComponent } from '@nestfolio/shell';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ShellLayoutComponent, SystemBannerComponent, LogoutButtonComponent],
  template: `
    <app-system-banner />
    <nf-shell-layout>
      @if (authStore.status() === 'authenticated') {
        <nf-logout-button nfHeaderActions />
      }
      <router-outlet />
    </nf-shell-layout>
  `,
  styles: [':host { display: block; }'],
})
export class AppComponent {
  readonly authStore = inject(AuthStore);
}
```

- [ ] **Step 4: Run the host spec and confirm all assertions pass**

Run: `pnpm nx test nestfolio-host --testPathPattern=app.component`

Expected: PASS — lightweight block (3 tests) and gating block (2 tests) all green.

- [ ] **Step 5: Commit**

```bash
git add apps/nestfolio-host/src/app/app.component.ts apps/nestfolio-host/test/app/app.component.spec.ts
git commit -m "feat(nestfolio-host): project LogoutButtonComponent into shell header"
```

---

## Task 5: End-to-end verification — affected-test sweep + dev server smoke

**Files:** none modified. Verification step only.

- [ ] **Step 1: Run nx affected test sweep**

Run: `pnpm nx affected -t test --base=HEAD~5`

Expected: all affected tests PASS. In particular:
- `shell` (includes the new `logout-button.component.spec.ts`)
- `ui` (includes the new `shell-layout.component.spec.ts`)
- `nestfolio-host` (includes the extended `app.component.spec.ts`)

If any unrelated project fails, treat it as a pre-existing issue — do not "fix" it in this plan.

- [ ] **Step 2: Run lint on the three affected projects**

Run: `pnpm nx run-many -t lint -p shell,ui,nestfolio-host`

Expected: PASS.

- [ ] **Step 3: Start the host dev server and visually verify**

Run: `pnpm nx serve nestfolio-host`

In the browser:
1. Navigate to `/login` — no logout button should appear in the header.
2. Log in with a test account.
3. Confirm the logout button is visible in the header actions area, with label + icon on desktop.
4. Resize the viewport below 768px — confirm the label hides and only the icon remains.
5. Click the logout button — confirm the URL becomes `/login` and the header no longer shows the button.
6. In the browser DevTools Network tab, simulate offline, log back in, then click logout — confirm the URL still becomes `/login` (fail-safe path).

If the button doesn't render, inspect the element: `AppComponent`'s template must contain `<nf-logout-button nfHeaderActions />` inside `<nf-shell-layout>` and `ShellLayoutComponent`'s template must contain `<ng-content select="[nfHeaderActions]" />` inside `<nf-header>`.

- [ ] **Step 4: Commit any final adjustments (if any) and wrap up**

If no code changes were needed in Step 3, skip this step. Otherwise:

```bash
git add -A
git commit -m "fix: address logout button visual verification feedback"
```

---

## Acceptance checklist — tick these manually before declaring done

- [ ] `LogoutButtonComponent` exists in `libs/shell/src/components/logout-button.component.ts` and is exported from `libs/shell/src/index.ts`.
- [ ] `ShellLayoutComponent` forwards `[nfHeaderActions]` content into `HeaderComponent`'s actions slot; default main-body `<ng-content/>` unchanged.
- [ ] Host `AppComponent` projects `<nf-logout-button nfHeaderActions />` gated on `authStore.status() === 'authenticated'`.
- [ ] Click → `authSignOut()` → `AuthStore.logout()` → `router.navigate(['/login'])`.
- [ ] Fail-safe: Amplify `signOut` rejection still triggers `AuthStore.logout()` + navigation.
- [ ] Button hidden on `/login`, `/signup`, `/confirm` (all reach those routes with `status !== 'authenticated'`).
- [ ] Responsive: label shown on ≥768px, icon-only under 768px.
- [ ] Unit tests for button, shell-layout projection, and host gating all green.
- [ ] No new dependency from `libs/ui` into `libs/shell`.

---

## Out-of-scope reminders

Do NOT do these — they are explicit non-goals from the spec:
- No confirmation dialog / `p-confirmDialog`.
- No session-timeout UI or "log out all devices".
- No account-menu / avatar dropdown.
- No changes to `LogoutOrchestrator`, `withLogoutReset`, or any `withLogoutReset`-registered store.
- No token-revocation changes on the Cognito user pool client.
- No bottom-nav placement — the logout action stays in the header on all breakpoints.
