import { afterEach, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';

const documents: Y.Doc[] = [];

afterEach(() => {
  for (const document of documents.splice(0)) document.destroy();
});

it('clears local awareness while hidden and restores the same presence on reuse', () => {
  const document = new Y.Doc();
  documents.push(document);
  const awareness = new Awareness(document);
  const time = new ManualTime();
  const channel = new PresenceChannel({
    awareness,
    principal: { id: 'agent-1', kind: 'agent', name: 'Ada' },
    clock: time,
    scheduler: time,
  });
  channel.setLocal({ cursor: { x: 12, y: 34 }, selection: ['shape-1'] });
  time.advanceBy(100);
  const before = awareness.getLocalState();
  expect(before).toMatchObject({ cursor: { x: 12, y: 34 }, selection: ['shape-1'] });

  channel.setHidden(true);
  expect(awareness.getLocalState()).toBeNull();
  time.advanceBy(20_000);
  expect(awareness.getLocalState(), 'renewal must not reveal an idle client').toBeNull();
  channel.setHidden(false);
  expect(awareness.getLocalState()).toEqual(before);
});
