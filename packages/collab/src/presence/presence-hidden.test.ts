import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';

const documents: Y.Doc[] = [];

afterEach(() => {
  for (const document of documents.splice(0)) document.destroy();
});

function open(): { awareness: Awareness; time: ManualTime; channel: PresenceChannel } {
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
  return { awareness, time, channel };
}

describe('PresenceChannel.setHidden', () => {
  it('keeps merging local changes while hidden and sends the latest once shown', () => {
    const { awareness, time, channel } = open();
    channel.setHidden(true);
    channel.setLocal({ cursor: { x: 1, y: 2 } });
    time.advanceBy(1_000);
    expect(awareness.getLocalState()).toBeNull();
    expect(channel.getLocal()).toMatchObject({ cursor: { x: 1, y: 2 } });
    channel.setHidden(false);
    expect(awareness.getLocalState()).toMatchObject({ cursor: { x: 1, y: 2 } });
  });

  it('drops a trailing flush pending when it hides', () => {
    const { awareness, time, channel } = open();
    channel.setLocal({ cursor: { x: 1, y: 1 } });
    channel.setLocal({ cursor: { x: 2, y: 2 } });
    channel.setHidden(true);
    time.advanceBy(1_000);
    expect(awareness.getLocalState()).toBeNull();
  });

  it('ignores a repeated state and any call after destroy', () => {
    const { awareness, channel } = open();
    channel.setHidden(false);
    const shown = awareness.getLocalState();
    channel.setHidden(false);
    expect(awareness.getLocalState()).toBe(shown);
    channel.destroy();
    channel.setHidden(false);
    expect(awareness.getLocalState()).toBeNull();
  });
});
