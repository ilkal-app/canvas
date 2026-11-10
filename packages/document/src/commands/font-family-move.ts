/**
 * A style moved to another family: its face name, which belongs to the old family, is dropped.
 *
 * @param style - A run's, an override record's or a board text style's style.
 * @param to - The new family.
 * @returns The style in the new family, without a face name.
 */
export function inFamily<Style extends object>(
  style: Style,
  to: string,
): Omit<Style, 'postScriptName'> & { fontFamily: string } {
  const rest = Object.fromEntries(
    Object.entries(style).filter(([field]) => field !== 'postScriptName'),
  ) as Omit<Style, 'postScriptName'>;
  return { ...rest, fontFamily: to };
}
