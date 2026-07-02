// runtime/cli.mjs — the on-ramp (§13). `runtime init` seeds the content ring from the starter pack;
// `watch`/`next` delegate to the ring-1 helpers. The "works on a normal repo in 10 minutes" wedge.
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function runInit({ from = 'runtime/starter/checks', to = 'runtime/content/checks' } = {}) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from).filter((n) => n.endsWith('.yaml'))) cpSync(join(from, f), join(to, f));
  return readdirSync(to).filter((n) => n.endsWith('.yaml')).length;
}

export async function dispatch(argv) {
  const [cmd] = argv;
  if (cmd === 'init') return void console.log(`seeded ${runInit({})} starter checks`);
  if (cmd === 'watch') return void (await import('./engine/lib/run-watch.mjs'));   // delegates via its CLI
  if (cmd === 'next') return void (await import('./engine/lib/plan-next.mjs'));
  console.error('usage: runtime <init|watch|next>'); process.exit(2);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) dispatch(process.argv.slice(2));
