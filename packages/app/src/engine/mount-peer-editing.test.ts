// A mount's peers editing, with the monospaced fake layout.
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_PEER_EDITING } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { TextEditingFeed } from '../editing/text-editing-feed.js';
import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { MONO_LAYOUT } from './__fixtures__/text-document.js';
import { MountPeerEditing } from './mount-peer-editing.js';
import { PEER_EDITING_LAYER } from './shell-overlay.js';

const NOTE = {
  id: 'note-1',
  type: 'sticky',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  width: 200,
  height: 200,
  text: 'Hi',
  runs: [{ length: 2, style: DEFAULT_TEXT_STYLE }],
  align: 'left',
  verticalAlign: 'top',
  autoWidth: false,
} as unknown as BoardObject;

const MIRA = {
  principalId: 'mira',
  name: 'Mira',
  color: '#ff0000',
  objectId: 'note-1',
  anchor: 0,
  focus: 2,
};

function setUp() {
  const objects = new Map<string, BoardObject>([['note-1', NOTE]]);
  const board = { get: (id: ObjectId) => objects.get(id) };
  const layers = { show: vi.fn() };
  const text = { editing: new TextEditingFeed() };
  const document = { tools: { services: () => ({ store: board }) } };
  const peers = new MountPeerEditing(document as never, MONO_LAYOUT, text, layers);
  return { peers, layers, text, objects };
}

describe('MountPeerEditing', () => {
  it('hands on the person’s own editing spot', () => {
    const { peers, text } = setUp();
    expect(peers.local).toBe(text.editing);
  });

  it('places the peers on texts the board holds, in their colour, and sends the model once', () => {
    const { peers, layers } = setUp();
    const placed = peers.show([MIRA, { ...MIRA, principalId: 'bo', objectId: 'gone' }]);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ principalId: 'mira', name: 'Mira', box: { width: 200 } });
    expect(layers.show).toHaveBeenCalledTimes(1);
    expect(layers.show).toHaveBeenCalledWith(
      PEER_EDITING_LAYER,
      expect.objectContaining({ peers: [expect.objectContaining({ color: [1, 0, 0, 1] })] }),
    );
    peers.show([MIRA]);
    expect(layers.show).toHaveBeenCalledTimes(1);
  });

  it('sends nothing at rest, and the empty model once the last peer stops', () => {
    const { peers, layers } = setUp();
    expect(peers.show([])).toEqual([]);
    expect(layers.show).not.toHaveBeenCalled();
    peers.show([MIRA]);
    peers.show([]);
    expect(layers.show).toHaveBeenLastCalledWith(PEER_EDITING_LAYER, EMPTY_PEER_EDITING);
  });
});
