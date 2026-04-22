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
