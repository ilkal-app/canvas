// Acceptance,
// written by Claude after the hosted coverage run of PR 153 showed no detach test had a
// connector in the main. Detach materialises the resolved content with fresh ids; a connector
// attached to a sibling inside the main must attach to that sibling's materialised copy (never
// to the main's child, nor to a virtual id), and a free end keeps its point.
import { expect, it } from 'vitest';

import { validateBoard, type ObjectId } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newConnectorTo,
  newSticky,
  placeInstance,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';

it('attaches a materialised connector to the materialised copy of its sibling, keeping a free end', () => {
  const store = new YjsDocumentStore({ clientId: 1 });
  createChild(store, newSticky('left', null, { x: 0, y: 0, width: 100, height: 100 }));
  createChild(store, newConnectorTo('link', 'left', { x: 300, y: 50 }));
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['left', 'link'],
    name: 'Linked',
    componentId: 'linked',
  });
  placeInstance(store, 'linked', { instanceId: 'inst', x: 1000, y: 0 });

  const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: 'inst' });
  const created = (result as { readonly createdIds: readonly ObjectId[] }).createdIds;
  const copies = created.map((createdId) => mustGet(store, createdId));
  const note = copies.find((object) => object.type === 'sticky');
  const link = copies.find((object) => object.type === 'connector');
  if (note === undefined || link?.type !== 'connector') throw new Error('expected both copies');

  expect(mustGet(store, 'inst').type).toBe('frame');
  expect([note.parentId, link.parentId]).toEqual(['inst', 'inst']);
  expect(link.to).toMatchObject({ kind: 'object', objectId: note.id });
  expect(link.from).toEqual({ kind: 'point', x: 300, y: 50 });
  expect(store.references.connectorsAttachedTo(note.id)).toEqual(new Set([link.id]));
  // The main's own connector still attaches to the main's sticky.
  expect(mustGet(store, 'link')).toMatchObject({ to: { objectId: 'left' } });
  expect(validateBoard(store.read())).toEqual([]);
});
