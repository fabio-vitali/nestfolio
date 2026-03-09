import { initFederation } from '@angular-architects/native-federation';

initFederation('/assets/federation.manifest.json')
  .then(() => import('./bootstrap'))
  .catch(err => {
    document.body.textContent = 'Failed to load application';
    console.error(JSON.stringify({ level: 'error', message: 'Federation init failed', error: String(err), timestamp: new Date().toISOString() }));
  });
