import { initFederation } from '@angular-architects/native-federation';

initFederation('/assets/federation.manifest.json')
  .then(() => import('./bootstrap'))
  .catch(err => {
    document.body.innerHTML = '<h1>Failed to load application</h1>';
    console.error('Federation init failed', err);
  });
