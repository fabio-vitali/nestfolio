import { Routes } from '@angular/router';
import { OnboardingStore } from './stores/onboarding.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [OnboardingStore],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./onboarding/onboarding-chat.component').then(
            (m) => m.OnboardingChatComponent,
          ),
      },
    ],
  },
];
