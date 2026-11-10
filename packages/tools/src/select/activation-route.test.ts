import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { id, selectBoardObjects, mapSource } from './__fixtures__/select-board.js';
import { activationRoute } from './activation-route.js';
import type { SelectPointerType } from './select-input.js';
import type { SelectIntent } from './select-intent.js';

const document = mapSource(selectBoardObjects());
const G = id('group-g');
const A = id('rect-a');

/**
 * A double press on an object.
 *
 * @param objectId - The object.
 * @param pointerType - The pointer; a mouse if absent.
 * @returns The intent.
 */
function activate(
  objectId: ObjectId,
  pointerType?: SelectPointerType,
): SelectIntent & { readonly type: 'activate' } {
  return {
    type: 'activate',
    id: objectId,
    world: { x: 0, y: 0 },
    ...(pointerType === undefined ? {} : { pointerType }),
  };
}

describe('activationRoute', () => {
  const top = { enteredGroupId: null };

  it('enters a group not yet entered, for a mouse and a finger alike', () => {
    expect(activationRoute(activate(G), document, top, {})).toBe('enter');
    expect(activationRoute(activate(G, 'touch'), document, top, {})).toBe('enter');
  });

  it('hands the entered group itself to onActivate, never to a zoom', () => {
    const inside = { enteredGroupId: G };
    expect(activationRoute(activate(G, 'touch'), document, inside, {})).toBe('activate');
  });

  it('zooms for a finger only where the object has no mode of its own', () => {
    expect(activationRoute(activate(A, 'touch'), document, top, {})).toBe('zoom');
    const canActivate = (objectId: ObjectId) => objectId === A;
    expect(activationRoute(activate(A, 'touch'), document, top, { canActivate })).toBe('activate');
  });

  it('keeps a mouse’s and a pen’s double press going to onActivate', () => {
    expect(activationRoute(activate(A), document, top, {})).toBe('activate');
    expect(activationRoute(activate(A, 'pen'), document, top, {})).toBe('activate');
  });
});
