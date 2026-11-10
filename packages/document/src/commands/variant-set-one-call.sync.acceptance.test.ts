// Acceptance
import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { createChild, newRectangle } from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

describe('one-call variant set sync', () => {
  it('sends the axes and every populated or empty preset in Yjs updates', () => {
    const ada = new YjsDocumentStore({ clientId: 1 });
    const bob = new YjsDocumentStore({ clientId: 2 });
    createChild(ada, newRectangle('part', null, { x: 20, y: 30, width: 120, height: 60 }));
    bob.applyUpdate(ada.encodeState(), RELAY);
    const axes = [
      { name: 'state', values: ['rest', 'hover'] },
      { name: 'size', values: ['20', '24'] },
    ];
    const presets = {
      'state=rest': {},
      'state=hover': { part: { fill: [0, 1, 0, 1] } },
      'size=20': {},
      'size=24': { part: { fill: [0, 0, 1, 1] } },
    };
    applyCommand(ada, mustFindCommand('createComponent'), {
      ids: ['part'],
      name: 'ToolButton',
      componentId: 'main',
      variantAxes: axes,
      variantPresets: { 'state=hover': presets['state=hover'], 'size=24': presets['size=24'] },
    });
    bob.applyUpdate(ada.encodeState(), RELAY);
    for (const store of [ada, bob]) {
      expect(fieldOf(store, 'main', 'variantAxes')).toEqual(axes);
      expect(fieldOf(store, 'main', 'variantPresets')).toEqual(presets);
      expect(validateBoard(store.read())).toEqual([]);
    }
    expect(bob.read().objects).toEqual(ada.read().objects);
  });
});
