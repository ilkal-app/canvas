import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { TEXT_LOD_RULE } from '../lod/lod-thresholds.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { Scene } from '../scene/scene.js';

import { coalesceMarkedSlots, visibleRanges } from './visible-ranges.js';

function marks(pattern: string): Uint8Array {
  return Uint8Array.from(pattern, (character) => (character === '#' ? 1 : 0));
}

describe('coalesceMarkedSlots', () => {
  it('turns each run of marked slots into one range', () => {
    expect(coalesceMarkedSlots(marks('##..###.#'), 0)).toEqual([
      { start: 0, count: 2 },
      { start: 4, count: 3 },
      { start: 8, count: 1 },
    ]);
  });

  it('bridges gaps no longer than the maximum, trading a few extra instances for draw calls', () => {
    expect(coalesceMarkedSlots(marks('##..###...#'), 2)).toEqual([
      { start: 0, count: 7 },
      { start: 10, count: 1 },
    ]);
    expect(coalesceMarkedSlots(marks('##..###...#'), 3)).toEqual([{ start: 0, count: 11 }]);
  });

  it('finds no ranges when nothing is marked, and ignores unmarked slots at the ends', () => {
    expect(coalesceMarkedSlots(marks('....'), 8)).toEqual([]);
    expect(coalesceMarkedSlots(marks('..##..'), 8)).toEqual([{ start: 2, count: 2 }]);
  });
});

describe('visibleRanges', () => {
  function sceneOf(count: number): Scene {
    const scene = new Scene([FILLED_RECT_PASS]);
    const document = new FakeSceneDocument();
    for (let index = 0; index < count; index += 1)
      document.create(shapeObject(`s${String(index)}`));
    scene.apply(document.takeChanges());
    return scene;
  }

  const ids = (...indices: number[]) => indices.map((index) => `s${String(index)}` as ObjectId);

  it('draws the slots of the visible objects, coalesced per pass', () => {
    const scene = sceneOf(10);
    expect(visibleRanges(scene, ids(1, 2, 3, 7), false, 0)).toEqual(
      new Map([
        [
          'solid-rect',
          [
            { start: 1, count: 3 },
            { start: 7, count: 1 },
          ],
        ],
      ]),
    );
  });

  it('draws each pass whole when everything is visible', () => {
    const scene = sceneOf(10);
    expect(visibleRanges(scene, [], true, 0)).toEqual(
      new Map([['solid-rect', [{ start: 0, count: 10 }]]]),
    );
  });

  it('leaves out passes with no visible records', () => {
    expect(visibleRanges(sceneOf(0), [], true, 0)).toEqual(new Map());
    expect(visibleRanges(sceneOf(3), ids(99), false, 0)).toEqual(new Map());
  });

  it('leaves out the records of objects a pass hides at this level of detail', () => {
    const hiding = {
      ...FILLED_RECT_PASS,
      levelOfDetail: {
        rule: TEXT_LOD_RULE,
        sizeOf: (object: BoardObject) => ('width' in object ? object.width : 0),
      },
    };
    const scene = new Scene([hiding]);
    const document = new FakeSceneDocument();
    document.create(
      shapeObject('s0'),
      shapeObject('s1', { width: 100 }),
      shapeObject('s2'),
      shapeObject('s3'),
    );
    scene.apply(document.takeChanges());
    // 10 units at 0.2 is 2 device px: hidden; 100 units is 20 px: drawn.
    scene.levelOfDetail.update(undefined, 0.2, { lodTransitions: 0, lodThrashes: 0 });
    const drawn = new Map([['solid-rect', [{ start: 1, count: 1 }]]]);
    expect(visibleRanges(scene, ids(0, 1, 2), false, 0)).toEqual(drawn);
    expect(visibleRanges(scene, [], true, 0)).toEqual(drawn);
  });
});
