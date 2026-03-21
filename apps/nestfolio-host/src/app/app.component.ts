import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellLayoutComponent } from '@nestfolio/ui';
import { AuthStore } from '@nestfolio/shell';

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
export class AppComponent {
  readonly authStore = inject(AuthStore);
}
