import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellLayoutComponent } from '@nestfolio/ui-components';
import { AuthStore } from '@nestfolio/shared-state';
import { getAuthUser } from '@nestfolio/auth';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ShellLayoutComponent],
  template: `
    <nf-shell-layout>
      <router-outlet />
    </nf-shell-layout>
  `,
  styles: [':host { display: block; }'],
})
export class AppComponent implements OnInit {
  readonly authStore = inject(AuthStore);

  async ngOnInit() {
    const user = await getAuthUser();
    if (user) {
      this.authStore.setAuthenticated({
        userId: user.userId,
        username: user.username,
        email: user.email ?? '',
        tenantId: user.tenantId ?? '',
      });
    } else {
      this.authStore.setUnauthenticated();
    }
  }
}
