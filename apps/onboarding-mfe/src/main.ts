import { initFederation } from '@angular-architects/native-federation';

/* eslint-disable no-console */
initFederation()
  .catch(err => console.error(err))
  .then(() => import('./bootstrap'))
  .catch(err => console.error(err));
