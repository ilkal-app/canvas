import type { TextStyle } from '@canvas/schema';

import { applyCommand } from '../../commands/__fixtures__/command-fixtures.js';
import { setTextRunsCommand } from '../../commands/set-text-runs.js';
import { ADA, BOB, BODY, id } from '../../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { createHistory, type UndoHistory } from '../undo-manager.js';

import { ADA_ID, createClientPair, Link } from './history-fixtures.js';

/** A winning rich label whose shared owner must be guarded during undo. */
export interface GuardedLabel {
  /** The winning client. */
  readonly ada: YjsDocumentStore;
  /** The client whose concurrent label lost. */
  readonly bob: YjsDocumentStore;
  /** Ada's recorded label replacement. */
  readonly history: UndoHistory;
  /** The winning label's text. */
  readonly text: string;
}

/**
 * Prepares a label race with independently formatted characters, creating many child items.
 *
 * @param characters - The number of rich-text characters.
 * @returns Both clients and Ada's history; destroy all three after the measurement.
 */
export function createGuardedLabel(characters: number): GuardedLabel {
  const [ada, bob] = createClientPair(2, 1);
  const link = new Link(ada, bob);
  ada.transact(ADA, (transaction) => {
    transaction.patchObject(id('shape-box'), { label: null });
  });
  link.deliver();
  const history = createHistory(ada, ADA_ID);
  link.disconnect();
  const text = 'a'.repeat(characters);
  const runs = Array.from(text, (unused, index) => ({
    length: 1,
    style: { ...BODY, weight: index % 2 === 0 ? 400 : 700 } satisfies TextStyle,
  }));
  applyCommand(ada, setTextRunsCommand, { id: id('shape-box'), text, runs }, ADA);
  applyCommand(
    bob,
    setTextRunsCommand,
    {
      id: id('shape-box'),
      text: 'bob',
      runs: [{ length: 3, style: BODY }],
    },
    BOB,
  );
  link.reconnect();
  return { ada, bob, history, text };
}
