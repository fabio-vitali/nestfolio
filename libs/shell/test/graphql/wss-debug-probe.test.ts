/**
 * @jest-environment jsdom
 */
import { installWssDebugProbe } from '../../src/graphql/wss-debug-probe';

declare global {
  var __nfWssDebug: boolean | undefined;
  var __nfWssProbeInstalled: boolean | undefined;
}

class FakeWebSocketBase {
  readonly url: string;
  readonly protocols?: string | string[];
  readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
  sendCalls: unknown[] = [];
  readyState = 0;
  protocol = '';

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = String(url);
    this.protocols = protocols;
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: unknown): void {
    this.sendCalls.push(data);
  }

  emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

describe('installWssDebugProbe', () => {
  let originalWebSocket: unknown;
  let consoleSpy: { log: jest.SpyInstance; warn: jest.SpyInstance; error: jest.SpyInstance };

  beforeEach(() => {
    originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocketBase as unknown as typeof WebSocket;
    delete (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug;
    delete (globalThis as { __nfWssProbeInstalled?: boolean }).__nfWssProbeInstalled;
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(() => undefined),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: jest.spyOn(console, 'error').mockImplementation(() => undefined),
    };
  });

  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
    delete (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug;
    delete (globalThis as { __nfWssProbeInstalled?: boolean }).__nfWssProbeInstalled;
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
  });

  it('is a no-op when __nfWssDebug is unset', () => {
    installWssDebugProbe('advisory');
    expect((globalThis as { WebSocket?: unknown }).WebSocket).toBe(FakeWebSocketBase);
  });

  it('replaces globalThis.WebSocket when __nfWssDebug is true', () => {
    (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug = true;
    installWssDebugProbe('advisory');
    expect((globalThis as { WebSocket?: unknown }).WebSocket).not.toBe(FakeWebSocketBase);
  });

  it('logs raw frames for AppSync realtime URLs', () => {
    (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug = true;
    installWssDebugProbe('advisory');
    const Patched = (globalThis as { WebSocket: new (url: string, p?: string | string[]) => FakeWebSocketBase }).WebSocket;
    const ws = new Patched('wss://localhost:4200/realtime/advisory/realtime', ['graphql-ws', 'header-abc']);

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('[wss-probe][advisory] new WebSocket'),
      expect.anything(),
    );

    ws.emit('message', { data: JSON.stringify({ type: 'connection_ack' }) });
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('[wss-probe][advisory] <-- recv'),
      JSON.stringify({ type: 'connection_ack' }),
    );

    ws.send(JSON.stringify({ type: 'start', id: 'abc', payload: { data: 'q' } }));
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('[wss-probe][advisory] --> send'),
      JSON.stringify({ type: 'start', id: 'abc', payload: { data: 'q' } }),
    );

    ws.emit('close', { code: 1006, reason: 'abnormal', wasClean: false });
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.stringContaining('CLOSE code=1006'),
    );
  });

  it('does not instrument non-AppSync URLs (e.g. HMR)', () => {
    (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug = true;
    installWssDebugProbe('advisory');
    const Patched = (globalThis as { WebSocket: new (url: string) => FakeWebSocketBase }).WebSocket;
    const ws = new Patched('ws://localhost:4200/_ng_/hmr');

    ws.emit('message', { data: '{"type":"ping"}' });
    expect(consoleSpy.log).not.toHaveBeenCalledWith(
      expect.stringContaining('<-- recv'),
      expect.anything(),
    );
  });

  it('is idempotent when called twice', () => {
    (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug = true;
    installWssDebugProbe('advisory');
    const First = (globalThis as { WebSocket: unknown }).WebSocket;
    installWssDebugProbe('advisory');
    expect((globalThis as { WebSocket: unknown }).WebSocket).toBe(First);
  });

  it('parses non-JSON string payloads as raw', () => {
    (globalThis as { __nfWssDebug?: boolean }).__nfWssDebug = true;
    installWssDebugProbe('advisory');
    const Patched = (globalThis as { WebSocket: new (url: string) => FakeWebSocketBase }).WebSocket;
    const ws = new Patched('wss://x.appsync-realtime-api.us-east-1.amazonaws.com/graphql');
    ws.emit('message', { data: 'not-json' });
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('<-- recv'),
      'not-json',
    );
    // Sanity: a non-string payload is coerced via String()
    ws.emit('message', { data: 42 });
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('<-- recv'),
      '42',
    );
  });
});
