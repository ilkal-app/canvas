/** What a {@link CollabSocket} reports to the client that opened it. */
export interface CollabSocketHandlers {
  /** The connection is open; the client may send. */
  onOpen(): void;
  /**
   * A binary frame arrived.
   *
   * @param data - The frame's bytes.
   */
  onMessage(data: Uint8Array): void;
  /**
   * The connection closed, failed to open, or failed. Called at most once per socket.
   *
   * @param code - The WebSocket close code.
   * @param reason - The close reason, possibly empty.
   */
  onClose(code: number, reason: string): void;
}

/** One connection attempt to the relay, as the client drives it. */
export interface CollabSocket {
  /**
   * Sends a binary frame; does nothing unless the connection is open.
   *
   * @param data - The frame.
   */
  send(data: Uint8Array): void;
  /** Closes the connection; `onClose` follows. */
  close(): void;
}

/**
 * Opens a connection to the relay. The client calls it once per attempt; tests inject a fake
 * transport here, and can count every byte that crosses it.
 */
export type CollabSocketFactory = (url: string, handlers: CollabSocketHandlers) => CollabSocket;

/** The part of the platform `WebSocket` the default factory uses. */
export interface WebSocketLike {
  /** Set to `arraybuffer`, so frames arrive as bytes. */
  binaryType: BinaryType;
  /** 1 while open. */
  readonly readyState: number;
  /** Sends a frame. */
  send(data: Uint8Array): void;
  /** Closes the connection. */
  close(): void;
  /** Called once the connection opens. */
  onopen: ((event: Event) => void) | null;
  /** Called with each frame. */
  onmessage: ((event: MessageEvent) => void) | null;
  /** Called once the connection closes or fails. */
  onclose: ((event: CloseEvent) => void) | null;
  /** Called on a failure; a close follows. */
  onerror: ((event: Event) => void) | null;
}

/** The WebSocket's `readyState` while it is open. */
const WEB_SOCKET_OPEN = 1;

/** The close code for a connection that ended without a close frame. */
const ABNORMAL_CLOSURE = 1006;

/**
 * Creates the default socket factory over the platform `WebSocket` (browsers, workers and
 * Node 22 alike). Text frames are ignored: the relay's protocol is binary.
 *
 * @param webSocketClass - The WebSocket constructor; default `globalThis.WebSocket`.
 * @returns The factory.
 */
export function createWebSocketFactory(
  webSocketClass: new (url: string) => WebSocketLike = globalThis.WebSocket,
): CollabSocketFactory {
  return (url, handlers) => {
    const webSocket = new webSocketClass(url);
    webSocket.binaryType = 'arraybuffer';
    webSocket.onopen = () => {
      handlers.onOpen();
    };
    webSocket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) handlers.onMessage(new Uint8Array(event.data));
    };
    // Browsers follow an error with a close; Node's WebSocket (undici) may not, for a refused
    // connection. Either ends the socket, so the client hears about it once, from the first.
    let isEnded = false;
    const end = (code: number, reason: string): void => {
      if (isEnded) return;
      isEnded = true;
      handlers.onClose(code, reason);
    };
    webSocket.onclose = (event) => {
      end(event.code, event.reason);
    };
    webSocket.onerror = () => {
      end(ABNORMAL_CLOSURE, 'error');
    };
    return {
      send: (data) => {
        if (webSocket.readyState === WEB_SOCKET_OPEN) webSocket.send(data);
      },
      close: () => {
        webSocket.close();
      },
    };
  };
}
