// The board owner's plan limits a board token carries (`ent`), read without verifying:
// the services check them again, and the page only uses them to explain or spare a request.

/**
 * A board token's `ent` claim.
 *
 * @param token - The board token, if held.
 * @returns The claim's fields, or undefined when the token is unreadable or has none.
 */
export function boardTokenPlanOf(
  token: string | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const payload = token?.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
    const claims: unknown = JSON.parse(atob(base64));
    const ent: unknown =
      typeof claims === 'object' && claims !== null ? (claims as { ent?: unknown }).ent : undefined;
    return typeof ent === 'object' && ent !== null
      ? (ent as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
}
