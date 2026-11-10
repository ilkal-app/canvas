/**
 * A named face's label in the inspector: its PostScript name's style part, after the
 * last `-`, with camel case split into words, as `PrivateSans-CondensedBold` reads `Condensed
 * Bold`; a name without `-` is split as a whole.
 *
 * @param postScriptName - The face's PostScript name.
 * @returns The label.
 */
export function faceLabel(postScriptName: string): string {
  const style = postScriptName.slice(postScriptName.lastIndexOf('-') + 1);
  return style.replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ');
}
