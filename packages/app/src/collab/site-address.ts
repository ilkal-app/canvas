/**
 * The query parameters that point a development page at another relay, token endpoint or assets
 * service, or hand it a board token (`parseBoardAddress`). A deployed page ignores them: a link must neither send
 * the signed-in user's token elsewhere nor make the page join as someone else's principal.
 */
export const ADDRESS_OVERRIDE_PARAMETERS = ['relay', 'tokenUrl', 'token', 'assets'] as const;

/** The relay and token endpoint a site build was built for (`VITE_RELAY_URL`, `VITE_TOKEN_URL`). */
export interface SiteEndpoints {
  /** The environment's relay, a `wss:` URL. */
  readonly relayUrl: string;
  /** The environment's token endpoint, an `https:` URL. */
  readonly tokenUrl: string;
  /** The environment's assets service, an `https:` URL; none when the build names none. */
  readonly assetsUrl?: string;
}

/**
 * Removes the relay, token endpoint and token overrides from a deployed page's query string. A
 * deployed page mints a real editor token for whoever is signed in, so it must never send one to
 * a relay or token endpoint that a link names: it talks only to the endpoints fixed at build
 * time. Nor does it take a token from the link (`?token=`), which would make it join as the
 * token's principal instead of the signed-in user (review.md "The app").
 *
 * @param search - `location.search`, with or without the leading `?`.
 * @returns The query string without the overrides, with its `?` (empty when nothing is left).
 */
export function lockSiteAddress(search: string): string {
  const parameters = new URLSearchParams(search);
  for (const name of ADDRESS_OVERRIDE_PARAMETERS) parameters.delete(name);
  const rest = parameters.toString();
  return rest === '' ? '' : `?${rest}`;
}

/** A build's endpoint variables, as the page found them (unchecked). */
export interface SiteEndpointVariables {
  /** `VITE_RELAY_URL`. */
  readonly relayUrl?: unknown;
  /** `VITE_TOKEN_URL`. */
  readonly tokenUrl?: unknown;
  /** `VITE_ASSETS_URL`, optional. */
  readonly assetsUrl?: unknown;
}

/**
 * Reads one endpoint of a site build, which must be set and use the given protocol.
 *
 * @param value - The variable's value.
 * @param name - The variable's name, for the message.
 * @param protocol - The protocol it must use.
 * @returns The URL as given.
 * @throws {RangeError} When it is unset or not a URL with that protocol.
 */
function readEndpoint(value: unknown, name: string, protocol: string): string {
  const text = typeof value === 'string' ? value : '';
  let url: URL | undefined;
  try {
    url = new URL(text);
  } catch {
    url = undefined;
  }
  if (url?.protocol !== protocol) {
    throw new RangeError(`A site build needs ${name}, a ${protocol} URL.`);
  }
  return text;
}

/**
 * The endpoints a site build talks to: its `VITE_RELAY_URL` (secure WebSocket) and
 * `VITE_TOKEN_URL` (HTTPS), both required, and its `VITE_ASSETS_URL` (HTTPS) if it has one. The web server's `Content-Security-Policy` lists the
 * same hosts in `connect-src`.
 *
 * @param env - The build's variables.
 * @returns The endpoints.
 * @throws {RangeError} When the relay or token endpoint is unset, or any is insecure.
 */
export function readSiteEndpoints(env: SiteEndpointVariables): SiteEndpoints {
  return {
    relayUrl: readEndpoint(env.relayUrl, 'VITE_RELAY_URL', 'wss:'),
    tokenUrl: readEndpoint(env.tokenUrl, 'VITE_TOKEN_URL', 'https:'),
    ...(env.assetsUrl === undefined || env.assetsUrl === ''
      ? {}
      : { assetsUrl: readEndpoint(env.assetsUrl, 'VITE_ASSETS_URL', 'https:') }),
  };
}
