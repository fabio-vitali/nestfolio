import { alpacaPaperReset } from './src/helpers/alpaca-paper-reset';

export default async function globalTeardown(): Promise<void> {
  const prefix = process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
  try {
    await alpacaPaperReset(prefix);
    // eslint-disable-next-line no-console
    console.log(`[globalTeardown] alpacaPaperReset OK (prefix=${prefix})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[globalTeardown] alpacaPaperReset FAILED (prefix=${prefix}):`, err);
    // Do not fail the suite on teardown errors — surface and continue.
  }
}
