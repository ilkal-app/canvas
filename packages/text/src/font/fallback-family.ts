/**
 * Infers a library fallback from the only shared metadata: the family name.
 * Unknown private names use sans; no private font metadata is added to the document.
 *
 * @param family - The stored family name.
 * @returns The closest known library category's family.
 */
export function fallbackFamily(family: string): string {
  if (/mono|courier|consolas|menlo|monaco|code|typewriter/i.test(family)) return 'JetBrains Mono';
  if (/comic|script|hand|cursive|brush|chancery/i.test(family)) return 'Caveat';
  if (/sans|arial|helvetica|verdana|tahoma|calibri|aptos/i.test(family)) return 'Liberation Sans';
  if (/serif|times|georgia|cambria|garamond|baskerville|palatino|book|didot|bodoni/i.test(family))
    return 'Lora';
  if (/impact|display|poster|condensed/i.test(family)) return 'Oswald';
  return 'Liberation Sans';
}
