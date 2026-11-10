import { describe, expect, it } from 'vitest';

import { DocumentVersionError } from './document-version-error.js';

describe('DocumentVersionError', () => {
  it('names one unstamped writer, several, or none, and never prints an unknown one', () => {
    expect(new DocumentVersionError('unversioned', undefined, [7]).message).toMatch(
      /^This board holds objects written by client 7 without a layout version/,
    );
    expect(new DocumentVersionError('unversioned', undefined, [9, 7]).message).toMatch(
      /written by clients 7, 9 without/,
    );
    const unnamed = new DocumentVersionError('unversioned', undefined);
    expect(unnamed.message).toMatch(/^This board holds objects written without a layout version/);
    expect(unnamed.message).not.toMatch(/undefined|by client/);
    expect(unnamed.writers).toEqual([]);
  });

  it('keeps the writers sorted and frozen, and names the relay gate', () => {
    const error = new DocumentVersionError('unversioned', undefined, [9, 7]);
    expect(error.writers).toEqual([7, 9]);
    expect(Object.isFrozen(error.writers)).toBe(true);
    expect(error.message).toMatch(/layout version gate/);
    expect(new DocumentVersionError('unreadable-version', { layoutVersion: 9 }).message).toMatch(
      /\{"layoutVersion":9\}.*layout version gate/,
    );
  });
});
