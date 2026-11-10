/** Where a tab keeps its guest id: session storage, so a reload keeps who the tab is. */
export const GUEST_SUBJECT_KEY = 'canvas.guestSubject';

const GUEST_SUBJECT_PATTERN = /^guest-[0-9a-f]{6}$/;

/**
 * Reads a stored value, treating a storage that throws (blocked, sandboxed) as empty.
 *
 * @param storage - The storage.
 * @returns The value, or null.
 */
function readStored(storage: Pick<Storage, 'getItem'> | undefined): string | null {
  try {
    return storage?.getItem(GUEST_SUBJECT_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * The tab's guest id until sign-in exists (`guest-` and six hex digits): the `sub` its board
 * tokens are fetched for, so two tabs are two principals with their own undo histories and
 * presence. Kept in session storage, so a reload is the same guest; each new tab is a new one.
 *
 * @param storage - The tab's session storage; none where the platform has none.
 * @param random - A uniform random number in [0, 1).
 * @returns The guest id.
 */
export function readGuestSubject(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  random: () => number,
): string {
  const stored = readStored(storage);
  if (stored !== null && GUEST_SUBJECT_PATTERN.test(stored)) return stored;
  const digits = Math.floor(random() * 0x1000000)
    .toString(16)
    .padStart(6, '0');
  const subject = `guest-${digits}`;
  try {
    storage?.setItem(GUEST_SUBJECT_KEY, subject);
  } catch {
    // A tab that cannot store its id is a new guest on every reload; nothing else changes.
  }
  return subject;
}
