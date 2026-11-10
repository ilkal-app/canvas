import type { PresenceSnapshot, PresenceState, WriterStampedPresence } from '@canvas/collab';
import type { UndoProtection } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

/**
 * Objects a notice is about, outlined on the canvas for as long as the notice shows (
 * the objects another person changed since, which an undo would not touch).
 */
export interface NoticeOutline {
  /** The objects. */
  readonly objectIds: readonly ObjectId[];
  /**
   * The outline's colour, `#rrggbb`: the presence colour of the person named as having changed
   * them; absent for the neutral outline, when nobody is named.
   */
  readonly color?: string;
}

/**
 * An undo or redo used up because another person changed what it would change since:
 * which objects, and the Yjs client ids that changed them.
 */
export interface ProtectedUndo {
  /** Whether it was an undo (else a redo). */
  readonly isUndo: boolean;
  /** The objects others changed since, and their Yjs client ids. */
  readonly protection: UndoProtection;
}

/**
 * Shows a sentence in the shell's notice; for an undo or redo another person's change kept from
 * changing anything, what they changed, so the shell can outline it (`noticeOf`).
 */
export type NoticeSink = (message: string, protectedUndo?: ProtectedUndo) => void;

/** A notice as the shell shows it: its sentence, and what to outline while it shows. */
export interface ShownNotice {
  /** The sentence. */
  readonly message: string;
  /** What to outline; none for most notices. */
  readonly outline?: NoticeOutline;
}

/**
 * The present person the relay vouches wrote every one of a protection's writer ids:
 * each id is in exactly one present person's relay-stamped `writerClientIds`, and it is the same
 * person for every id. A writer who has left, a change the product made itself, an id two people
 * claim, or two different writers name nobody.
 *
 * @param writers - The Yjs client ids that changed the objects (`UndoProtection.writers`).
 * @param presence - Who is present, by awareness client id.
 * @returns The person's presence, or undefined when nobody can be named.
 */
export function vouchedWriterOf(
  writers: readonly number[],
  presence: PresenceSnapshot,
): PresenceState | undefined {
  let named: PresenceState | undefined;
  for (const writer of writers) {
    const claims = [...presence.values()].filter(
      // Type-only, so the collab client stays out of the library bundle (`writerClientIdsOf`).
      (state) =>
        (state as PresenceState & WriterStampedPresence).writerClientIds?.includes(writer) === true,
    );
    const [only] = claims;
    if (claims.length !== 1 || only === undefined) return undefined;
    if (named !== undefined && named !== only) return undefined;
    named = only;
  }
  return named;
}

/**
 * The notice of an undo or redo used up because another person changed what it would change
 * since (item 5), with the objects they changed outlined while the notice
 * shows. When the relay vouches for exactly one present person as the writer of every change in
 * the way (`vouchedWriterOf`: a writer's Yjs client id is chosen by the writing
 * client, so only the relay's stamp in presence can tie it to a person), the notice names them,
 * "Can't undo — Mira changed this since" ("Can't redo" for a redo), and the outline takes their
 * presence colour; the name is the token's signed one, else the principal id
 * (`isNameSigned`). Otherwise it keeps's words ("Nothing to undo here: this has changed
 * since.") and the neutral outline. Pure.
 *
 * @param message - The sentence the engine gave.
 * @param protectedUndo - What another person's change kept from changing, if that is why.
 * @param presence - Who is present, with the writer ids the relay vouches for; nobody if absent.
 * @returns The notice.
 */
export function noticeOf(
  message: string,
  protectedUndo: ProtectedUndo | undefined,
  presence: PresenceSnapshot = new Map(),
): ShownNotice {
  if (protectedUndo === undefined) return { message };
  const { objectIds, writers } = protectedUndo.protection;
  const writer = vouchedWriterOf(writers, presence);
  if (writer === undefined) return { message, outline: { objectIds } };
  const { name, id, color } = writer.principal;
  // Only what the relay vouches for names them: the token's signed name, else the principal id
  // (a name the client chose could be anyone's). A relay that stamps writer ids always says
  // whether the name is signed. Presence can also leave a name empty.
  const isNameSigned = (writer as PresenceState & WriterStampedPresence).isNameSigned !== false;
  const shown = isNameSigned && name !== '' ? name : id;
  return {
    message: `Can't ${protectedUndo.isUndo ? 'undo' : 'redo'} — ${shown} changed this since`,
    outline: { objectIds, color },
  };
}
