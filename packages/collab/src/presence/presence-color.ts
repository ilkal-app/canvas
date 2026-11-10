/**
 * The Ilkal colourways presence gives principals: each person and agent is drawn in one,
 * their cursor round in its colours. Order matters: it is part of the deterministic mapping, so
 * appending is safe and reordering recolours everyone.
 */
export const PRESENCE_COLOURWAYS = Object.freeze([
  'gulabi',
  'kesari',
  'neeli',
  'kempu',
  'nerale',
  'hasiru',
] as const);

/** One of the {@link PRESENCE_COLOURWAYS}. */
export type PresenceColourway = (typeof PRESENCE_COLOURWAYS)[number];

/**
 * The colours presence assigns to principals that bring none: each colourway's dark, in the
 * order of {@link PRESENCE_COLOURWAYS} (the brand kit's `tokens/brand.json`), which stays legible
 * as an avatar's fill on a light or a dark canvas. A principal's presence colour is the dark of
 * its colourway.
 */
export const PRESENCE_PALETTE: readonly string[] = Object.freeze([
  '#cf4766',
  '#ea7a3c',
  '#296dc7',
  '#c74d29',
  '#7a52c9',
  '#3aa293',
]);

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * A principal's place in the presence colourways.
 *
 * @param principalId - The user's or agent's id.
 * @returns An index into {@link PRESENCE_COLOURWAYS} and {@link PRESENCE_PALETTE}.
 */
function colourwayIndexOf(principalId: string): number {
  // FNV-1a over UTF-16 code units: cheap, stable across engines, and spreads short similar ids.
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < principalId.length; index += 1) {
    hash ^= principalId.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash % PRESENCE_COLOURWAYS.length;
}

/**
 * Picks a principal's colourway from {@link PRESENCE_COLOURWAYS}. Every client computes the same
 * colourway for the same id, with no coordination, so a collaborator keeps one colourway across
 * sessions and screens, and their own view and their peers' agree.
 *
 * @param principalId - The user's or agent's id.
 * @returns The colourway.
 */
export function colourwayForPrincipal(principalId: string): PresenceColourway {
  return PRESENCE_COLOURWAYS[colourwayIndexOf(principalId)] ?? 'neeli';
}

/**
 * Picks a principal's presence colour: the dark of its colourway ({@link colourwayForPrincipal}),
 * from {@link PRESENCE_PALETTE}.
 *
 * @param principalId - The user's or agent's id.
 * @returns A `#rrggbb` colour from the palette.
 */
export function colorForPrincipal(principalId: string): string {
  return PRESENCE_PALETTE[colourwayIndexOf(principalId)] ?? '#296dc7';
}
