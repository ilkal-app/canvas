import { describe, expect, it } from 'vitest';

import { GUEST_SUBJECT_KEY, readGuestSubject } from './guest-subject.js';

/**
 * A session storage in memory.
 *
 * @param entries - What it holds to begin with.
 * @returns The storage.
 */
function memoryStorage(entries: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('readGuestSubject', () => {
  it('makes a guest id from the random source and keeps it for the tab', () => {
    const storage = memoryStorage();
    const subject = readGuestSubject(storage, () => 0.5);
    expect(subject).toBe('guest-800000');
    expect(storage.getItem(GUEST_SUBJECT_KEY)).toBe(subject);
    expect(readGuestSubject(storage, () => 0.25)).toBe(subject);
  });

  it('replaces a stored value that is not a guest id', () => {
    const storage = memoryStorage({ [GUEST_SUBJECT_KEY]: 'user:admin' });
    expect(readGuestSubject(storage, () => 0)).toBe('guest-000000');
  });

  it('still answers when there is no storage, or it throws', () => {
    expect(readGuestSubject(undefined, () => 0.999_999_99)).toBe('guest-ffffff');
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(readGuestSubject(throwing, () => 0)).toBe('guest-000000');
  });
});
