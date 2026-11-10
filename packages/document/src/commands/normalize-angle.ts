/**
 * Brings an angle into (−π, π], so repeated turns and reparents do not grow the stored number
 * (`rotateObjects`, and `moveObjects` taking an object into a turned frame). An angle already
 * in range comes back unchanged, bit for bit. An angle that is not finite (the sum of two angles
 * stored far past the board bound can overflow) becomes 0, so the result is always storable.
 *
 * @param angle - The angle, radians.
 * @returns The same turn, radians, in (−π, π].
 */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const turn = 2 * Math.PI;
  // The remainder is exact, so an angle of any size wraps into range; one already in range comes
  // back unchanged, bit for bit.
  const wrapped = angle % turn;
  if (wrapped > Math.PI) return wrapped - turn;
  return wrapped <= -Math.PI ? wrapped + turn : wrapped;
}
