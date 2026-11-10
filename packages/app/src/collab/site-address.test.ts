import { describe, expect, it } from 'vitest';

import { lockSiteAddress, readSiteEndpoints } from './site-address.js';

const ENDPOINTS = {
  relayUrl: 'wss://relay.example.test',
  tokenUrl: 'https://staging.canvas.example/token',
};

describe('lockSiteAddress', () => {
  it('drops the relay and token endpoint overrides, keeping the board and the rest', () => {
    expect(
      lockSiteAddress(
        '?board=x&relay=wss://evil.example&tokenUrl=https://evil.example/t&theme=dark',
      ),
    ).toBe('?board=x&theme=dark');
  });

  it('drops a board token from the link: the page joins only as the signed-in user', () => {
    expect(lockSiteAddress('?board=x&token=eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe('?board=x');
    expect(lockSiteAddress('?board=x&assets=https://elsewhere.test')).toBe('?board=x');
  });

  it('drops the local-only override too: a deployed page always talks to its relay', () => {
    expect(lockSiteAddress('?relay=off')).toBe('');
  });

  it('leaves a query without overrides as it is', () => {
    expect(lockSiteAddress('?board=a%20b')).toBe('?board=a+b');
    expect(lockSiteAddress('')).toBe('');
  });
});

describe('readSiteEndpoints', () => {
  it('accepts the build’s own secure relay and token endpoint', () => {
    expect(readSiteEndpoints(ENDPOINTS)).toEqual(ENDPOINTS);
  });

  it.each([
    [{ tokenUrl: ENDPOINTS.tokenUrl }, /VITE_RELAY_URL/],
    [{ relayUrl: ENDPOINTS.relayUrl }, /VITE_TOKEN_URL/],
    [{ ...ENDPOINTS, relayUrl: 'ws://relay.example' }, /VITE_RELAY_URL/],
    [{ ...ENDPOINTS, tokenUrl: 'http://app.example/token' }, /VITE_TOKEN_URL/],
    [{ ...ENDPOINTS, relayUrl: 'not a url' }, /VITE_RELAY_URL/],
    [{ ...ENDPOINTS, relayUrl: 42 }, /VITE_RELAY_URL/],
  ])('refuses a site build with %o', (env, message) => {
    expect(() => readSiteEndpoints(env)).toThrow(message);
  });

  it('reads an optional secure assets service', () => {
    expect(readSiteEndpoints({ ...ENDPOINTS, assetsUrl: 'https://assets.example' })).toEqual({
      ...ENDPOINTS,
      assetsUrl: 'https://assets.example',
    });
    expect(readSiteEndpoints({ ...ENDPOINTS, assetsUrl: '' })).toEqual(ENDPOINTS);
    expect(() => readSiteEndpoints({ ...ENDPOINTS, assetsUrl: 'http://assets.example' })).toThrow(
      /VITE_ASSETS_URL/,
    );
  });
});
