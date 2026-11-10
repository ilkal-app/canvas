/**
 * Encodes text as base64url, the JWT segment encoding.
 *
 * @param text - The text, UTF-8 encoded first.
 * @returns The base64url text, unpadded.
 */
function base64Url(text: string): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Builds a board token with the given claims and a placeholder signature. The client decodes
 * a token without verifying it (the relay verifies), so tests need no signing key.
 *
 * @param claims - The token's payload.
 * @returns A compact JWT whose signature is not valid.
 */
export function unsignedToken(claims: Readonly<Record<string, unknown>>): string {
  return [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(JSON.stringify(claims)),
    'not-a-signature',
  ].join('.');
}

/** The claims of an editor's token for `board-1`. */
export const EDITOR_CLAIMS = Object.freeze({
  sub: 'user-ada',
  boardId: 'board-1',
  role: 'editor',
  principal: 'user',
  exp: 2_000_000_000,
});
