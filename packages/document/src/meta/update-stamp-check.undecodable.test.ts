import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { fixtureGateBoard, rawUpdate, setRawContent } from './__fixtures__/gate-boards.js';
import { holdsUndecodableContent } from './undecodable-content.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// Values Yjs cannot decode. JSON, an embed and a format's value are JSON text, which
// Yjs parses while it reads an update, before it applies any of it; a hostile encoder's literal
// `NaN` is no JSON, so `Y.applyUpdate` throws on it wherever it would land. The check says where
// such values would land, so the relay never hands the bytes to Yjs: on the board (refused), or
// nowhere (in an object deleted since its writer saw it), where the same value in `ContentAny`
// is taken and dropped by Yjs.

/** A placement as JSON text no parser takes. */
const NAN_PLACEMENT = '{"parentId":null,"x":1,"y":2,"rotation":NaN}';

/** A text format whose value is written from raw JSON text. */
class RawFormatContent extends Y.ContentFormat {
  readonly #text: string;

  /**
   * Holds the text.
   *
   * @param key - The format's key.
   * @param text - Its value's JSON text.
   */
  constructor(key: string, text: string) {
    super(key, {});
    this.#text = text;
  }

  /**
   * Writes the key and the raw value, as `ContentFormat` writes them.
   *
   * @param encoder - The update's encoder.
   */
  override write(encoder: Y.UpdateEncoderV1 | Y.UpdateEncoderV2): void {
    encoder.writeKey(this.key);
    encoder.writeString(this.#text);
  }
}

/**
 * Writes `sticky-idea`'s key as raw content in a copy of the fixture board made before the hub
 * deletes the sticky, so the write lands in an object deleted since its writer saw it.
 *
 * @param kind - The content kind.
 * @returns The hub, after the delete, and the update.
 */
function intoDeletedSticky(kind: 'json' | 'embed'): { hub: Y.Doc; update: Uint8Array } {
  const board = fixtureGateBoard();
  const stale = new Y.Doc();
  stale.clientID = 91;
  Y.applyUpdate(stale, Y.encodeStateAsUpdate(board.hub));
  board.hub.getMap(OBJECTS_MAP_NAME).delete('sticky-idea');
  const update = rawUpdate({ hub: stale }, (objects) => {
    const sticky = objects.get('sticky-idea');
    if (sticky === undefined) throw new Error('no sticky');
    setRawContent(sticky, 'placement', kind, NAN_PLACEMENT);
  });
  stale.destroy();
  return { hub: board.hub, update };
}

describe('UpdateStampCheck: values Yjs cannot decode', () => {
  it('says such a value under a judged key of an object on the board lands, beside the refused value', () => {
    const board = fixtureGateBoard();
    const update = rawUpdate(board, (objects) => {
      const sticky = objects.get('sticky-idea');
      if (sticky !== undefined) setRawContent(sticky, 'placement', 'json', NAN_PLACEMENT);
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toMatchObject({
      kind: 'accepted',
      hostileValue: { objectId: 'sticky-idea', reason: 'not-a-plain-value' },
      undecodable: 'on-board',
    });
  });

  it('says one under a key the door does not judge lands, though nothing else is refused', () => {
    const board = fixtureGateBoard();
    const update = rawUpdate(board, (objects) => {
      const sticky = objects.get('sticky-idea');
      if (sticky !== undefined) setRawContent(sticky, 'locked', 'embed', 'NaN');
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({
      kind: 'accepted',
      undecodable: 'on-board',
    });
  });

  it.each(['json', 'embed'] as const)(
    'says one written as %s into an object deleted since lands nowhere',
    (kind) => {
      const { hub, update } = intoDeletedSticky(kind);
      expect(new UpdateStampCheck(hub).check(update)).toEqual({
        kind: 'accepted',
        undecodable: 'nowhere',
      });
      expect(() => {
        Y.applyUpdate(new Y.Doc(), update);
      }).toThrow(SyntaxError);
    },
  );

  it('finds a format whose value does not parse', () => {
    const board = fixtureGateBoard();
    const update = rawUpdate(board, (objects, doc) => {
      const text = doc.getText('scratch');
      text.insert(0, 'ab', { bold: true });
      for (let item = text._start; item !== null; item = item.right) {
        if (item.content instanceof Y.ContentFormat) {
          item.content = new RawFormatContent(item.content.key, '{"on":NaN}');
        }
      }
      expect(objects.size).toBeGreaterThan(0);
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({
      kind: 'accepted',
      undecodable: 'on-board',
    });
    expect(holdsUndecodableContent(update)).toBe(true);
  });

  it('refuses for good an update it would not accept anyway that holds one', () => {
    const board = fixtureGateBoard();
    const peer = new Y.Doc();
    peer.clientID = 92;
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(board.hub));
    const before = Y.encodeStateVector(board.hub);
    peer.transact(() => {
      // No stamp: an object entry from a writer that never stamped.
      const entry = new Y.Map<unknown>();
      peer.getMap(OBJECTS_MAP_NAME).set('unstamped', entry);
      setRawContent(entry, 'placement', 'json', NAN_PLACEMENT);
    });
    const update = Y.encodeStateAsUpdate(peer, before);
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({
      kind: 'undecodable',
      writers: [],
    });
  });

  it('finds none in JSON that parses, the name undefined included', () => {
    const board = fixtureGateBoard();
    const update = rawUpdate(board, (objects) => {
      const sticky = objects.get('sticky-idea');
      if (sticky !== undefined) setRawContent(sticky, 'locked', 'json', 'undefined');
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({ kind: 'accepted' });
    expect(holdsUndecodableContent(update)).toBe(false);
    expect(holdsUndecodableContent(intoDeletedSticky('json').update)).toBe(true);
  });
});
