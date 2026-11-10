import { describe, expect, it } from 'vitest';

import { DEFAULT_BOARD_ID, devTokenUrlFor, parseBoardAddress } from './board-address.js';

const DEV = { relayUrl: 'ws://127.0.0.1:1234' } as const;

describe('parseBoardAddress', () => {
  it('opens the demo board on the default relay, with tokens from the dev endpoint beside it', () => {
    expect(parseBoardAddress('', DEV)).toEqual({
      boardId: DEFAULT_BOARD_ID,
      relayUrl: 'ws://127.0.0.1:1234',
      token: undefined,
      tokenUrl: 'http://127.0.0.1:1235/token',
    });
    expect(DEFAULT_BOARD_ID).toBe('demo');
  });

  it('reads the board, relay, token and token endpoint from the query string', () => {
    expect(
      parseBoardAddress(
        '?board=team%20plan&relay=wss://relay.example.com&token=a.b.c&tokenUrl=https://api.example.com/t',
        DEV,
      ),
    ).toEqual({
      boardId: 'team plan',
      relayUrl: 'wss://relay.example.com',
      token: 'a.b.c',
      tokenUrl: 'https://api.example.com/t',
    });
  });

  it('works without a relay when none is configured, or when the page says relay=off', () => {
    expect(parseBoardAddress('?board=x', { relayUrl: undefined }).relayUrl).toBeUndefined();
    expect(parseBoardAddress('?relay=off', DEV).relayUrl).toBeUndefined();
    expect(parseBoardAddress('?relay=', DEV).relayUrl).toBeUndefined();
  });

  it('prefers a configured token endpoint to the one beside the relay', () => {
    expect(
      parseBoardAddress('', { ...DEV, tokenUrl: 'http://localhost:9000/token' }).tokenUrl,
    ).toBe('http://localhost:9000/token');
  });

  it('treats an empty board as the default one', () => {
    expect(parseBoardAddress('?board=%20', DEV).boardId).toBe(DEFAULT_BOARD_ID);
  });

  it('refuses a relay that is not a WebSocket URL, and a token endpoint that is not HTTP', () => {
    expect(() => parseBoardAddress('?relay=http://127.0.0.1:1234', DEV)).toThrow(/relay/);
    expect(() => parseBoardAddress('?relay=nonsense', DEV)).toThrow(/relay/);
    expect(() => parseBoardAddress('?tokenUrl=ftp://x', DEV)).toThrow(/tokenUrl/);
    expect(() => parseBoardAddress('?assets=ws://x', DEV)).toThrow(/assets/);
  });

  it('reads the assets service from the query string, else the default, off for none', () => {
    expect(parseBoardAddress('?assets=http://127.0.0.1:1236/', DEV).assetsUrl).toBe(
      'http://127.0.0.1:1236',
    );
    expect(parseBoardAddress('', { ...DEV, assetsUrl: 'https://a.test' }).assetsUrl).toBe(
      'https://a.test',
    );
    expect(
      parseBoardAddress('?assets=off', { ...DEV, assetsUrl: 'https://a.test' }).assetsUrl,
    ).toBe(undefined);
    expect(parseBoardAddress('', DEV).assetsUrl).toBeUndefined();
  });
});

describe('devTokenUrlFor', () => {
  it('is the next port on the same host, over HTTP for ws and HTTPS for wss', () => {
    expect(devTokenUrlFor('ws://127.0.0.1:1234')).toBe('http://127.0.0.1:1235/token');
    expect(devTokenUrlFor('wss://relay.example.com:8443/')).toBe(
      'https://relay.example.com:8444/token',
    );
  });

  it('is /token on the same origin when the relay URL names no port', () => {
    expect(devTokenUrlFor('wss://relay.example.com')).toBe('https://relay.example.com/token');
  });
});
