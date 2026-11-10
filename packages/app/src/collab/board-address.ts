/** The board the playground opens when the page names none: `demo`. */
export const DEFAULT_BOARD_ID = 'demo';

/** The relay `pnpm dev:relay` starts: the playground's default outside harness builds. */
export const DEV_RELAY_URL = 'ws://127.0.0.1:1234';

/** Which board a page opens, on which relay, and where its board tokens come from. */
export interface BoardAddress {
  /** The board id: the relay's document name. */
  readonly boardId: string;
  /** The relay's WebSocket URL; `undefined` when there is none and the board stays local. */
  readonly relayUrl: string | undefined;
  /** A board token given with the page (`?token=`), used as it is; `undefined` to fetch one. */
  readonly token: string | undefined;
  /** Where tokens are fetched when none is given; `undefined` without a relay. */
  readonly tokenUrl: string | undefined;
  /**
   * The assets service the board's images live on, `?assets=` or the build's; none
   * without one, and the page then cannot add images.
   */
  readonly assetsUrl: string | undefined;
}

/** What a page falls back to when its query string does not say. */
export interface BoardAddressDefaults {
  /** The relay; `undefined` for none (harness builds, which connect only when told to). */
  readonly relayUrl: string | undefined;
  /** The token endpoint; the one beside the relay (`devTokenUrlFor`) if absent. */
  readonly tokenUrl?: string | undefined;
  /** The assets service; none if absent. */
  readonly assetsUrl?: string | undefined;
}

/**
 * Parses a URL, or says which parameter was wrong.
 *
 * @param value - The URL.
 * @param protocols - The protocols allowed.
 * @param parameter - The query parameter it came from, for the message.
 * @returns The URL.
 * @throws {RangeError} When it is not a URL with one of the protocols.
 */
function parseUrl(value: string, protocols: readonly string[], parameter: string): URL {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (url === undefined || !protocols.includes(url.protocol)) {
    throw new RangeError(`${parameter} must be a ${protocols.join(' or ')} URL, got "${value}".`);
  }
  return url;
}

/**
 * The development token endpoint beside a relay (`pnpm dev:relay` serves it): the same host
 * on the next port, `/token`, over HTTP for `ws:` and HTTPS for `wss:`; for a relay URL with no
 * port, `/token` on the same origin.
 *
 * @param relayUrl - The relay's WebSocket URL.
 * @returns The token endpoint's URL.
 */
export function devTokenUrlFor(relayUrl: string): string {
  const relay = new URL(relayUrl);
  const token = new URL('/token', relay);
  token.protocol = relay.protocol === 'wss:' ? 'https:' : 'http:';
  if (relay.port !== '') token.port = String(Number(relay.port) + 1);
  return token.toString();
}

/**
 * Reads which board the page opens: `?board=<id>` (the demo board by
 * default), `?relay=<ws URL>` (the default relay if absent; `off` or empty for none, which keeps
 * the board local), `?token=<board token>` (used as it is) and `?tokenUrl=<http URL>` (where
 * tokens are fetched otherwise; the default, or the endpoint beside the relay) and
 * `?assets=<http URL>` (the assets service the board's images live on; the default if absent,
 * `off` or empty for none).
 *
 * @param search - `location.search`, with or without the leading `?`.
 * @param defaults - The relay and token endpoint when the query string names none.
 * @returns The address.
 * @throws {RangeError} When `relay` is not a `ws:`/`wss:` URL, or `tokenUrl` or `assets` not an
 *   HTTP one.
 */
export function parseBoardAddress(search: string, defaults: BoardAddressDefaults): BoardAddress {
  const parameters = new URLSearchParams(search);
  const boardId = parameters.get('board')?.trim() ?? '';
  const relayParameter = parameters.get('relay');
  const relayValue = relayParameter ?? defaults.relayUrl;
  const relayUrl =
    relayValue === undefined || relayValue === '' || relayValue === 'off'
      ? undefined
      : parseUrl(relayValue, ['ws:', 'wss:'], 'relay').toString().replace(/\/$/, '');
  const tokenUrlParameter = parameters.get('tokenUrl');
  const tokenUrl =
    tokenUrlParameter === null
      ? (defaults.tokenUrl ?? (relayUrl === undefined ? undefined : devTokenUrlFor(relayUrl)))
      : parseUrl(tokenUrlParameter, ['http:', 'https:'], 'tokenUrl').toString();
  const token = parameters.get('token');
  const assetsValue = parameters.get('assets') ?? defaults.assetsUrl;
  const assetsUrl =
    assetsValue === undefined || assetsValue === '' || assetsValue === 'off'
      ? undefined
      : parseUrl(assetsValue, ['http:', 'https:'], 'assets').toString().replace(/\/$/, '');
  return {
    boardId: boardId === '' ? DEFAULT_BOARD_ID : boardId,
    relayUrl,
    token: token === null || token === '' ? undefined : token,
    tokenUrl,
    assetsUrl,
  };
}
