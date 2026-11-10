// The nightly fuzz's raw-mode closures of honest clients ("the relay refused it:
// update-malformed hostile-values c1s18 placement (not-a-record); client 4's last step on c1s18:
// step 70 deleteObjects"). Ada deletes an object while Bob moves it; undoing the delete
// re-creates the object, Yjs refuses to restore the placement Bob's move replaced, and the field
// guard writes the placement from before the delete (`restoreEmptiedFields`, case 2). A
// placement a peer wrote as JSON or an embed is a plain value (`Y.Map#get` returns it, the door
// judges it as one), but the guard read only `ContentAny` and wrote `null` for anything else:
// Ada's board held an unreadable object and the door refused her undo, closing her for good.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setRawContent } from '../meta/__fixtures__/gate-boards.js';
import { stampDocument } from '../meta/stamp-document.js';
import { UpdateStampCheck } from '../meta/update-stamp-check.js';
import { BOB, createFixtureStore, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { ADA_PRINCIPAL } from './__fixtures__/door-fixtures.js';
import { createHistory } from './undo-manager.js';

/** The sticky's placement on the fixture board, as JSON text. */
const PLACEMENT = { parentId: 'frame-plan', x: 40, y: 120, rotation: 0 };

/**
 * Writes the sticky's placement through a peer, in the given content, and delivers it to Ada.
 *
 * @param ada - Ada's store.
 * @param kind - `json` or `embed` (content a peer's own encoder writes), or `any` (as Yjs does).
 */
function writePlacement(ada: YjsDocumentStore, kind: 'json' | 'embed' | 'any'): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, ada.encodeState());
  peer.transact(() => {
    stampDocument(peer);
    const sticky = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('sticky-idea');
    if (sticky === undefined) throw new Error('no sticky on the fixture board');
    if (kind === 'any') sticky.set('placement', PLACEMENT);
    else setRawContent(sticky, 'placement', kind, JSON.stringify(PLACEMENT));
  });
  ada.applyUpdate(Y.encodeStateAsUpdate(peer, ada.encodeStateVector()), RELAY);
  peer.destroy();
}

describe("an undo of a delete that restores a field a collaborator's edit replaced", () => {
  it.each(['json', 'embed', 'any'] as const)(
    'restores a placement written as %s as the value it was: the board stays readable and the relay takes the undo',
    (kind) => {
      const ada = createFixtureStore();
      writePlacement(ada, kind);
      const bob = new YjsDocumentStore({ clientId: 5 });
      bob.applyUpdate(ada.encodeState(), RELAY);
      const history = createHistory(ada, ADA_PRINCIPAL);
      applyCommand(ada, deleteObjectsCommand, { ids: ['sticky-idea'] });
      applyCommand(
        bob,
        moveObjectsCommand,
        { moves: [{ id: 'sticky-idea', by: { x: 5, y: 0 } }] },
        BOB,
      );
      // The relay's copy holds both; Ada receives Bob's move, discarded in her deleted map.
      const hub = new Y.Doc();
      Y.applyUpdate(hub, ada.encodeState());
      Y.applyUpdate(hub, bob.encodeState());
      ada.applyUpdate(bob.encodeState(ada.encodeStateVector()), RELAY);
      const before = Y.encodeStateVector(hub);

      expect(history.undo()).toBe(true);

      expect(ada.read().issues).toEqual([]);
      expect(ada.get('sticky-idea' as never)).toMatchObject({ x: PLACEMENT.x, y: PLACEMENT.y });
      expect(new UpdateStampCheck(hub).check(ada.encodeState(before))).toEqual({
        kind: 'accepted',
      });
      history.destroy();
      bob.destroy();
      ada.destroy();
    },
  );
});
