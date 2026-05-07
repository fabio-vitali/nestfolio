/**
 * Opt-in WebSocket constructor wrapper that logs raw AppSync subscription
 * protocol frames to console. Activated when `globalThis.__nfWssDebug === true`
 * (set by Playwright `addInitScript` before app boot).
 *
 * Captures: WS construction, send (start/stop/ka), recv (connection_ack,
 * data, error, ka), error, close. Frames originate from the AppSync
 * `graphql-ws` subprotocol used by `aws-appsync-subscription-link`.
 *
 * Cost: zero when the flag is unset (no-op return). When set: one extra
 * console.log per frame on AppSync sockets only — non-AppSync sockets
 * (HMR, etc.) are passthrough.
 */

declare global {
  var __nfWssDebug: boolean | undefined;
  var __nfWssProbeInstalled: boolean | undefined;
}

type WebSocketCtor = typeof WebSocket;

function isAppsyncRealtimeUrl(url: string): boolean {
  return /\/realtime|appsync-realtime-api/.test(url);
}

function parseFrame(data: unknown): string {
  if (typeof data !== 'string') return String(data);
  // Return the raw string — Playwright trace previews truncate object args
  // to "Object" without capturing payload contents. Strings are fully
  // captured so we can read AppSync's error frames verbatim.
  return data;
}

export function installWssDebugProbe(domain: string): void {
  if (typeof globalThis === 'undefined') return;
  if (!globalThis.__nfWssDebug) return;
  if (globalThis.__nfWssProbeInstalled) return;

  const Original = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!Original) return;

  const tag = `[wss-probe][${domain}]`;

  class ProbedWebSocket extends Original {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const urlStr = String(url);
      if (!isAppsyncRealtimeUrl(urlStr)) return;

      // eslint-disable-next-line no-console
      console.log(`${tag} new WebSocket url=${urlStr} protocols=`, protocols);

      this.addEventListener('open', () => {
        // eslint-disable-next-line no-console
        console.log(`${tag} OPEN readyState=${this.readyState} protocol=${this.protocol}`);
      });
      this.addEventListener('error', (ev) => {
        // eslint-disable-next-line no-console
        console.error(`${tag} ERROR`, ev);
      });
      this.addEventListener('close', (ev: Event) => {
        const ce = ev as CloseEvent;
        // eslint-disable-next-line no-console
        console.warn(`${tag} CLOSE code=${ce.code} reason="${ce.reason ?? ''}" wasClean=${ce.wasClean}`);
      });
      this.addEventListener('message', (ev: Event) => {
        const me = ev as MessageEvent;
        // eslint-disable-next-line no-console
        console.log(`${tag} <-- recv`, parseFrame(me.data));
      });

      const origSend = this.send.bind(this);
      this.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        // eslint-disable-next-line no-console
        console.log(`${tag} --> send`, parseFrame(data));
        origSend(data);
      };
    }
  }

  (globalThis as { WebSocket: WebSocketCtor }).WebSocket = ProbedWebSocket as unknown as WebSocketCtor;
  globalThis.__nfWssProbeInstalled = true;
  // eslint-disable-next-line no-console
  console.log(`[wss-probe] installed for domain=${domain}`);
}
