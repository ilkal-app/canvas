import { describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import { SYSTEM_ORIGIN } from '@canvas/document';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnectionStatus } from '../collab/board-connection-status.js';
import { LOCAL_USER_ORIGIN } from '../engine/demo-document.js';

import { boardBarSubtitle } from './floating-board-bar.js';
import { lastEditOf, OWN_EDIT_AUTHOR } from './use-last-edit.js';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

function changes(isLocal: boolean, origin = LOCAL_USER_ORIGIN): ChangeSet {
  return { origin, isLocal, created: ['a'], updated: [], deleted: [] } as unknown as ChangeSet;
}

function status(
  state: BoardConnectionStatus['state'],
  names: readonly string[],
): BoardConnectionStatus {
  const base = new FakeBoardConnection('demo').status();
  return {
    ...base,
    state,
    collaborators: names.map((name) => ({ ...base.collaborators[0], name })),
  } as BoardConnectionStatus;
}

describe('lastEditOf', () => {
  it('counts the person’s own edits, never the product’s', () => {
    expect(lastEditOf(changes(true), undefined, NOW)).toEqual({ at: NOW, by: OWN_EDIT_AUTHOR });
    expect(lastEditOf(changes(true, SYSTEM_ORIGIN), undefined, NOW)).toBeUndefined();
  });

  it('counts a remote edit once synced, named only when one other person is here', () => {
    expect(lastEditOf(changes(false), status('connecting', ['Ana']), NOW)).toBeUndefined();
    expect(lastEditOf(changes(false), status('reconnecting', ['Ana']), NOW)).toBeUndefined();
    expect(lastEditOf(changes(false), undefined, NOW)).toBeUndefined();
    expect(lastEditOf(changes(false), status('connected', ['Ana']), NOW)).toEqual({
      at: NOW,
      by: 'Ana',
    });
    expect(lastEditOf(changes(false), status('connected', ['Ana', 'Bo']), NOW)).toEqual({
      at: NOW,
      by: undefined,
    });
    expect(lastEditOf(changes(false), status('connected', []), NOW)).toEqual({
      at: NOW,
      by: undefined,
    });
  });
});

describe('boardBarSubtitle', () => {
  it("says when this session's last edit was and by whom", () => {
    expect(boardBarSubtitle({ at: NOW, by: 'You' }, undefined, NOW)).toBe('Edited just now by You');
    expect(boardBarSubtitle({ at: NOW - 120_000, by: undefined }, null, NOW)).toMatch(
      /^Edited 2 minutes ago$/,
    );
  });

  it("falls back on the board record's last edit, and says nothing for a board never edited", () => {
    const yesterday = new Date(NOW - 26 * 3_600_000).toISOString();
    expect(boardBarSubtitle(undefined, yesterday, NOW)).toMatch(/^Edited (yesterday|1 day ago)$/);
    expect(boardBarSubtitle({ at: NOW, by: 'You' }, yesterday, NOW)).toBe('Edited just now by You');
    expect(boardBarSubtitle(undefined, null, NOW)).toBeUndefined();
    expect(boardBarSubtitle(undefined, undefined, NOW)).toBeUndefined();
    expect(boardBarSubtitle(undefined, 'not a time', NOW)).toBeUndefined();
  });
});
