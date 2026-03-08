import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellLayoutComponent } from '@nestfolio/ui-components';
import { AuthStore } from '@nestfolio/shared-state';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ShellLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nf-shell-layout>
      <router-outlet />
    </nf-shell-layout>
  `,
  styles: [':host { display: block; }'],
})
export class AppComponent {
  readonly authStore = inject(AuthStore);
}
