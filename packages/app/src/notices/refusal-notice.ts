import type { CommandError } from '@canvas/document';

/**
 * What the shell says when the document refuses a command the person asked for (a drop into a
 * frame that cannot take the objects, a restyle of an object deleted meanwhile): the first
 * problem, and how many more there were.
 *
 * @param errors - The command's errors.
 * @returns The notice's text.
 */
export function refusalNotice(errors: readonly CommandError[]): string {
  const [first] = errors;
  if (first === undefined) return 'That change could not be made.';
  const more = errors.length > 1 ? ` (and ${String(errors.length - 1)} more)` : '';
  return `That change could not be made: ${first.message}${more}.`;
}
