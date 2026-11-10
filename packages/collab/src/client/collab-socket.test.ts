import { describe, expect, it, vi } from 'vitest';

import { createWebSocketFactory, type WebSocketLike } from './collab-socket.js';

/** A stand-in for the platform WebSocket that records what the adapter does with it. */
class FakeWebSocket implements WebSocketLike {
  static last: FakeWebSocket | undefined;
  binaryType: BinaryType = 'blob';
  readyState = 0;
  readonly sent: unknown[] = [];
  isClosed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.last = this;
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.isClosed = true;
  }
}

function open() {
  const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
  const socket = createWebSocketFactory(FakeWebSocket)('ws://relay', handlers);
  const raw = FakeWebSocket.last;
  if (raw === undefined) throw new Error('no socket');
  return { handlers, socket, raw };
}

describe('createWebSocketFactory', () => {
  it('opens a binary WebSocket to the url', () => {
    const { raw } = open();
    expect(raw.url).toBe('ws://relay');
    expect(raw.binaryType).toBe('arraybuffer');
  });

  it('forwards open and binary messages, and ends the socket once on an error then a close', () => {
    const { handlers, raw } = open();
    raw.onopen?.(new Event('open'));
    raw.onmessage?.(new MessageEvent('message', { data: new Uint8Array([1, 2]).buffer }));
    raw.onmessage?.(new MessageEvent('message', { data: 'text frame' }));
    raw.onerror?.(new Event('error'));
    raw.onclose?.({ code: 1006, reason: 'gone' } as CloseEvent);
    expect(handlers.onOpen).toHaveBeenCalledOnce();
    expect(handlers.onMessage).toHaveBeenCalledExactlyOnceWith(new Uint8Array([1, 2]));
    expect(handlers.onClose).toHaveBeenCalledExactlyOnceWith(1006, 'error');
  });

  it('ends the socket on a close without an error, as browsers report a clean close', () => {
    const { handlers, raw } = open();
    raw.onclose?.({ code: 1000, reason: 'bye' } as CloseEvent);
    raw.onerror?.(new Event('error'));
    expect(handlers.onClose).toHaveBeenCalledExactlyOnceWith(1000, 'bye');
  });

  it('sends only while the socket is open, and closes it', () => {
    const { socket, raw } = open();
    socket.send(new Uint8Array([1]));
    raw.readyState = 1;
    socket.send(new Uint8Array([2]));
    socket.close();
    expect(raw.sent).toEqual([new Uint8Array([2])]);
    expect(raw.isClosed).toBe(true);
  });

  it('uses the platform WebSocket by default', () => {
    expect(typeof createWebSocketFactory()).toBe('function');
  });
});
