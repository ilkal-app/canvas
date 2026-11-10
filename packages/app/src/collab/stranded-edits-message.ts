import type { StrandedEdits } from '@canvas/collab';

/**
 * What the app tells the person about edits a layout bump stranded, plainly: the
 * board, how many unsent changes, the two stored layouts, and that the changes stay on this
 * device until dismissed. Pure.
 *
 * @param edits - The stranded edits.
 * @param boardName - The board's name as the page shows it (its id where it has none).
 * @returns Two sentences.
 */
export function strandedEditsMessage(edits: StrandedEdits, boardName: string): string {
  if (edits.exportSource !== undefined)
    return `A saved copy of “${boardName}” needs manual recovery. The original stays on this device. Download a copy to keep it elsewhere. This notice appears again when you reopen the board.`;
  const isOne = edits.unsentChangeCount === 1;
  const changes = `${String(edits.unsentChangeCount)} unsent ${isOne ? 'change' : 'changes'}`;
  const from = String(edits.fromLayoutVersion);
  const to = String(edits.toLayoutVersion);
  return (
    `${changes} to “${boardName}” ${isOne ? 'was' : 'were'} made in an older version of the app ` +
    `(stored layout ${from}) and could not be carried over to this version (stored layout ` +
    `${to}). ${isOne ? 'It is' : 'They are'} kept on this device until you dismiss this ` +
    `notice, which deletes ${isOne ? 'it' : 'them'}.`
  );
}
