// How a client tells the relay which stored layouts it reads: a query parameter on the
// WebSocket URL, `?layouts=1,2` (comma-separated, ascending). It is a property of the client's
// build, not of the user's rights, so it travels beside the board token instead of inside it:
// the application backend that signs tokens does not know which build will present them.

/** The WebSocket URL's query parameter that carries a client's readable layouts. */
export const READABLE_LAYOUTS_PARAMETER = 'layouts';

/**
 * The most layout versions a declaration may list; the rest are ignored. 64 since layout 33,
 * the 33rd a build reads: a relay with the old 32 would drop it, so the relay deploys
 * before the app.
 */
const MAX_DECLARED_LAYOUTS = 64;

/**
 * Writes readable layout versions as the value of {@link READABLE_LAYOUTS_PARAMETER}.
 *
 * @param versions - The layout versions a build reads (`READABLE_LAYOUT_VERSIONS`).
 * @returns The versions, ascending, without repeats, joined by commas; empty for none.
 */
export function formatReadableLayouts(versions: readonly number[]): string {
  return [...new Set(versions)].sort((first, second) => first - second).join(',');
}

/**
 * Reads a client's declared layout versions. Anything that is not a positive whole number is
 * left out, so a missing or malformed declaration reads as none: such a client counts as able to
 * read only boards nobody has stamped (the gate fails closed, `canReadBoardLayout`).
 *
 * @param value - The parameter's value, or `null` when the client sent none.
 * @returns The versions, ascending, without repeats; frozen.
 */
export function parseReadableLayouts(value: string | null | undefined): readonly number[] {
  if (value === null || value === undefined || value === '') return Object.freeze([]);
  const versions = new Set<number>();
  for (const part of value.split(',').slice(0, MAX_DECLARED_LAYOUTS)) {
    if (!/^\d{1,9}$/.test(part.trim())) continue;
    const version = Number(part.trim());
    if (version > 0) versions.add(version);
  }
  return Object.freeze([...versions].sort((first, second) => first - second));
}
