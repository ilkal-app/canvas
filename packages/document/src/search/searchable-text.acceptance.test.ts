// Extraction reads only the fields that board search promises to index.
import { describe, expect, it } from 'vitest';

import { importBoard, type BoardObject } from '@canvas/schema';

import { createFixtureBoardJson } from '../codec/__fixtures__/fixture-board-json.js';
import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import { searchableTextOf } from './searchable-text.js';

describe('searchableTextOf', () => {
  it('extracts sticky bodies, text bodies, shape and connector labels, and frame names', () => {
    expect(searchableTextOf(fixtureObject('sticky-idea', 'sticky'))).toEqual({
      group: 'stickies',
      text: 'Ship the beta 😀',
    });
    expect(searchableTextOf(fixtureObject('text-title', 'text'))).toEqual({
      group: 'text',
      text: 'Launch plan v2',
    });
    expect(searchableTextOf(fixtureObject('shape-box', 'shape'))).toEqual({
      group: 'text',
      text: 'API',
    });
    expect(searchableTextOf(fixtureObject('connector-flow', 'connector'))).toEqual({
      group: 'text',
      text: 'becomes',
    });
    expect(searchableTextOf(fixtureObject('frame-plan', 'frame'))).toEqual({
      group: 'sections',
      text: 'Launch plan',
    });
  });

  it('does not index layer names or objects outside the three groups', () => {
    const shape = fixtureObject('shape-star', 'shape');
    expect(searchableTextOf({ ...shape, name: 'Layer only' })).toBeUndefined();
    for (const [objectId, type] of [
      ['image-photo', 'image'],
      ['video-demo', 'video'],
      ['line-divider', 'line'],
      ['path-squiggle', 'path'],
      ['group-diagram', 'group'],
      ['comment-free', 'comment'],
    ] as const) {
      const object = fixtureObject(objectId, type);
      expect(searchableTextOf({ ...object, name: 'Layer only' })).toBeUndefined();
    }
    const withComponents = importBoard(createFixtureBoardJson(true));
    for (const object of withComponents.objects.values()) {
      if (object.type === 'component' || object.type === 'instance') {
        expect(searchableTextOf(object)).toBeUndefined();
      }
    }
  });

  it('omits absent and whitespace-only content without changing its input', () => {
    const sticky = fixtureObject('sticky-idea', 'sticky');
    const text = fixtureObject('text-title', 'text');
    const shape = fixtureObject('shape-box', 'shape');
    const connector = fixtureObject('connector-flow', 'connector');
    const frame = fixtureObject('frame-plan', 'frame');
    if (shape.label === null || connector.label === null) throw new Error('fixture labels missing');
    const objects: BoardObject[] = [
      { ...sticky, text: ' \n\t ' },
      { ...text, text: ' \n\t ' },
      { ...shape, label: null },
      { ...shape, label: { ...shape.label, text: ' \n\t ' } },
      { ...connector, label: null },
      { ...connector, label: { ...connector.label, text: ' \n\t ' } },
      { ...frame, name: ' \n\t ' },
    ];
    for (const object of objects) {
      const before = structuredClone(object);
      expect(searchableTextOf(object)).toBeUndefined();
      expect(object).toEqual(before);
    }
  });
});
