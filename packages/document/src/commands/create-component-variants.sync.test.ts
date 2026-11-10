import { describe, expect, it } from 'vitest';

import type { Rgba } from '@canvas/schema';

import { ADA, BOB, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { createChild, newRectangle } from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

// A set created with `createComponent`'s `variantAxes` holds an empty map per preset before
// anyone edits it, so two people's first edits to the same preset, at different
// paths, both survive: neither creates the preset's map under a key the other also creates.

const RED: Rgba = [1, 0, 0, 1];
const GREEN: Rgba = [0, 1, 0, 1];

/**
 * A preset edit of one part of the main.
 *
 * @param path - The part.
 * @param fill - Its fill in the `hover` preset.
 * @returns The command input.
 */
function hoverFill(path: string, fill: Rgba) {
  return { componentId: 'main', axis: 'state', value: 'hover', path, override: { fill } };
}

describe('first edits to one preset of a new set', () => {
  it.each([
    [1, 2],
    [2, 1],
  ])('merge at different paths (client ids %i/%i)', (adaId, bobId) => {
    const ada = new YjsDocumentStore({ clientId: adaId });
    const bob = new YjsDocumentStore({ clientId: bobId });
    createChild(ada, newRectangle('left', null, { x: 0, y: 0, width: 60, height: 60 }));
    createChild(ada, newRectangle('right', null, { x: 80, y: 0, width: 60, height: 60 }));
    applyCommand(ada, mustFindCommand('createComponent'), {
      ids: ['left', 'right'],
      name: 'Pair',
      componentId: 'main',
      variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    bob.applyUpdate(ada.encodeState(), RELAY);
    const preset = mustFindCommand('setVariantPreset');
    applyCommand(ada, preset, hoverFill('left', RED), ADA);
    applyCommand(bob, preset, hoverFill('right', GREEN), BOB);
    const [fromAda, fromBob] = [ada.encodeState(), bob.encodeState()];
    ada.applyUpdate(fromBob, RELAY);
    bob.applyUpdate(fromAda, RELAY);
    const expected = {
      'state=rest': {},
      'state=hover': { left: { fill: RED }, right: { fill: GREEN } },
    };
    expect(fieldOf(ada, 'main', 'variantPresets')).toEqual(expected);
    expect(fieldOf(bob, 'main', 'variantPresets')).toEqual(expected);
  });
});
