import { describe, expect, it } from 'vitest';

import { hitPaletteOf, type ColorTokenValues } from '@canvas/engine';
import type { BoardObject, ColorMode, ObjectId, Rgba } from '@canvas/schema';

import {
  frame,
  indexOf,
  mapSource,
  rect,
  selectBoardObjects,
} from './__fixtures__/select-board.js';
import { createSelectHitTester } from './select-hit-tester.js';

const CLEAR: Rgba = [0, 0, 0, 0];

function tester(change: (objects: BoardObject[]) => BoardObject[] = (objects) => objects) {
  const objects = change(selectBoardObjects());
  return createSelectHitTester(indexOf(objects), mapSource(objects));
}

function lockFrameF(objects: BoardObject[]): BoardObject[] {
  return objects.map((object) => (object.id === 'frame-f' ? { ...object, locked: true } : object));
}

describe('createSelectHitTester: points', () => {
  it('asks the canvas for its pixel ratio at every pick, to flatten paths as they are drawn', () => {
    const objects = selectBoardObjects();
    const ratios: number[] = [];
    const hits = createSelectHitTester(indexOf(objects), mapSource(objects), () => {
      ratios.push(2);
      return 2;
    });
    hits.hitPoint({ x: -1000, y: -1000 }, 1);
    hits.hitPoint({ x: -1000, y: -1000 }, 2);
    expect(ratios).toEqual([2, 2]);
  });

  it('picks the topmost object under a point, a frame’s child above its frame', () => {
    const hits = tester();
    expect(hits.hitPoint({ x: 430, y: 30 }, 1)).toEqual({
      id: 'rect-c',
      part: 'object',
      scope: null,
    });
    // Bare board: 12 px above connector-k, past its 6 px pick tolerance.
    expect(hits.hitPoint({ x: 120, y: 14 }, 1)).toBeUndefined();
  });

  it('reports a frame’s background as its background, not as the frame', () => {
    expect(tester().hitPoint({ x: 600, y: 150 }, 1)).toEqual({
      id: 'frame-f',
      part: 'background',
      scope: null,
    });
  });

  it('picks a frame by its title band above the top edge, sized on screen', () => {
    const hits = tester();
    expect(hits.hitPoint({ x: 600, y: -10 }, 1)).toEqual({
      id: 'frame-f',
      part: 'title',
      scope: null,
    });
    expect(hits.hitPoint({ x: 600, y: -30 }, 1)).toBeUndefined();
    expect(hits.hitPoint({ x: 600, y: -30 }, 0.5)).toEqual({
      id: 'frame-f',
      part: 'title',
      scope: null,
    });
  });

  it('lets an object over a title band win, and a nested frame’s title win over its parent’s background', () => {
    const hits = tester((objects) => [
      ...objects,
      rect('rect-above', null, { x: 450, y: -20, width: 20, height: 10 }),
      {
        ...frame('frame-n', 'frame-f', { x: 100, y: 100, width: 100, height: 80 }),
        showName: true,
      },
    ]);
    expect(hits.hitPoint({ x: 455, y: -15 }, 1)).toEqual({
      id: 'rect-above',
      part: 'object',
      scope: null,
    });
    expect(hits.hitPoint({ x: 550, y: 90 }, 1)).toEqual({
      id: 'frame-n',
      part: 'title',
      scope: null,
    });
    expect(hits.hitPoint({ x: 550, y: 150 }, 1)).toEqual({
      id: 'frame-n',
      part: 'background',
      scope: null,
    });
  });

  it('lets a title band beat only its own ancestors’ backgrounds, whatever the zoom', () => {
    // Two frames 60 apart, as the demo board's sections are: frame-top covers y 1000–1200 and
    // frame-low y 1260–1460. At 25% a band is 96 world units tall, so frame-low's covers
    // y 1164–1260, over the bottom of frame-top.
    const hits = tester((objects) => [
      ...objects,
      frame('frame-top', null, { x: 0, y: 1000, width: 300, height: 200 }),
      frame('frame-low', null, { x: 0, y: 1260, width: 300, height: 200 }),
    ]);
    expect(hits.hitPoint({ x: 150, y: 1190 }, 0.25)).toEqual({
      id: 'frame-top',
      part: 'background',
      scope: null,
    });
    // In the gap, over empty board, the band is the only thing there.
    expect(hits.hitPoint({ x: 150, y: 1230 }, 0.25)).toEqual({
      id: 'frame-low',
      part: 'title',
      scope: null,
    });
  });

  it('picks the parent’s background, not a hidden nested name, above a nested frame', () => {
    const hits = tester((objects) => [
      ...objects,
      frame('frame-n', 'frame-f', { x: 100, y: 100, width: 100, height: 80 }),
    ]);
    expect(hits.hitPoint({ x: 550, y: 90 }, 1)).toEqual({
      id: 'frame-f',
      part: 'background',
      scope: null,
    });
  });

  it('finds a nested frame’s band under an unrelated band that paints above it', () => {
    // At 20% bands are 120 units: frame-n (in frame-top, at y 1150–1190) has its band over
    // y 1030–1150, and frame-low, painted above frame-top, has its band over y 1140–1260.
    const hits = tester((objects) => [
      ...objects,
      frame('frame-top', null, { x: 0, y: 1000, width: 300, height: 200 }),
      {
        ...frame('frame-n', 'frame-top', { x: 100, y: 150, width: 100, height: 40 }),
        showName: true,
      },
      { ...frame('frame-low', null, { x: 0, y: 1260, width: 300, height: 200 }), z: 'a5' },
    ]);
    expect(hits.hitPoint({ x: 150, y: 1145 }, 0.2)).toEqual({
      id: 'frame-n',
      part: 'title',
      scope: null,
    });
  });

  it('picks a turned object where it is drawn, not where its unturned box would be', () => {
    const hits = tester();
    expect(hits.hitPoint({ x: 175, y: 90 }, 1)).toEqual({
      id: 'rect-b',
      part: 'object',
      scope: null,
    });
    expect(hits.hitPoint({ x: 250, y: 25 }, 1)).toBeUndefined();
  });

  it('picks a grouped object’s outermost group, and a locked object or frame', () => {
    const hits = tester(lockFrameF);
    expect(hits.hitPoint({ x: 70, y: 310 }, 1)).toEqual({
      id: 'group-g',
      part: 'object',
      scope: null,
    });
    expect(hits.hitPoint({ x: 810, y: 10 }, 1)).toEqual({
      id: 'rect-locked',
      part: 'object',
      scope: null,
    });
    expect(hits.hitPoint({ x: 600, y: -10 }, 1)).toEqual({
      id: 'frame-f',
      part: 'title',
      scope: null,
    });
  });
});

describe('createSelectHitTester: transparent frames', () => {
  it.each([null, [0.2, 0.4, 0.6, 0] as Rgba])(
    'reaches an unselected filled object under an unpainted frame (%j)',
    (background) => {
      const under = rect('under', null, { x: 0, y: 0, width: 200, height: 160 });
      const front = {
        ...frame('front', null, { x: 0, y: 0, width: 200, height: 160 }),
        z: 'a1',
        background,
      };
      const objects = [under, front];
      const hits = createSelectHitTester(indexOf(objects), mapSource(objects));
      expect(hits.hitPoint({ x: 100, y: 80 }, 1)).toEqual({
        id: under.id,
        part: 'object',
        scope: null,
      });
      expect(hits.hitPoint({ x: 100, y: -10 }, 1)).toEqual({
        id: front.id,
        part: 'title',
        scope: null,
      });
      expect(hits.frameAt({ x: 100, y: 80 }, () => true)).toBe(front.id);
    },
  );
  it('reaches through a frame background or a shape fill token transparent in its mode', () => {
    const tokens: ColorTokenValues = new Map([['ghost', { light: CLEAR, dark: [0, 0, 1, 1] }]]);
    const under = rect('under', null, { x: 0, y: 0, width: 200, height: 160 });
    const ghostRect = {
      ...rect('ghost-rect', null, { x: 0, y: 0, width: 200, height: 160 }),
      z: 'a1',
      fill: { token: 'ghost' },
    };
    const front = {
      ...frame('front', null, { x: 0, y: 0, width: 200, height: 160 }),
      z: 'a2',
      background: { token: 'ghost' },
    };
    const objects = [under, ghostRect, front] as BoardObject[];
    const source = mapSource(objects);
    let theme: ColorMode = 'light';
    const paletteOf = hitPaletteOf(source, { tokens: () => tokens, theme: () => theme });
    const hits = createSelectHitTester(indexOf(objects), source, () => 1, paletteOf);
    expect(hits.hitPoint({ x: 100, y: 80 }, 1)?.id).toBe(under.id);
    theme = 'dark';
    expect(hits.hitPoint({ x: 100, y: 80 }, 1)?.id).toBe(front.id);
  });
});

describe('createSelectHitTester: marquees', () => {
  it('intersect takes what it touches, as groups, without locked objects or a frame it only touches', () => {
    const hits = tester();
    const touched = hits.hitRect({ minX: 90, minY: 40, maxX: 850, maxY: 320 }, 'intersect');
    // connector-k's route, (100, 25) to (420, 45), crosses y 40 near its end.
    expect([...touched].sort()).toEqual(['connector-k', 'group-g', 'rect-a', 'rect-b', 'rect-c']);
  });

  it('intersect over part of a frame takes its children, not the frame', () => {
    const hits = tester();
    // connector-k ends on rect-c's left side, inside the marquee.
    expect(hits.hitRect({ minX: 390, minY: -10, maxX: 480, maxY: 80 }, 'intersect')).toEqual([
      'rect-c',
      'connector-k',
    ]);
    expect(hits.hitRect({ minX: 450, minY: 50, maxX: 690, maxY: 190 }, 'intersect')).toEqual([
      'rect-c',
    ]);
  });

  it('takes a frame it encloses in either direction, which carries its children', () => {
    const hits = tester();
    const around = { minX: 390, minY: -10, maxX: 710, maxY: 210 };
    // connector-k, which ends inside the frame, is touched but not enclosed.
    expect(hits.hitRect(around, 'intersect')).toEqual(['frame-f', 'connector-k']);
    expect(hits.hitRect(around, 'contain')).toEqual(['frame-f']);
  });

  it('leaves out a locked frame even when enclosed, and takes its children instead', () => {
    const hits = tester(lockFrameF);
    const around = { minX: 390, minY: -10, maxX: 710, maxY: 210 };
    expect(hits.hitRect(around, 'intersect')).toEqual(['rect-c', 'connector-k']);
    expect(hits.hitRect(around, 'contain')).toEqual(['rect-c']);
  });

  it('contain takes only what it wholly encloses', () => {
    const hits = tester();
    const enclosed = hits.hitRect({ minX: -10, minY: -10, maxX: 205, maxY: 105 }, 'contain');
    expect([...enclosed].sort()).toEqual(['rect-a', 'rect-b']);
    // Enclosing rect-c alone selects the child, not its frame.
    expect(hits.hitRect({ minX: 410, minY: 10, maxX: 480, maxY: 80 }, 'contain')).toEqual([
      'rect-c',
    ]);
  });

  it('contain takes a group only when it holds the whole group', () => {
    const hits = tester();
    expect(hits.hitRect({ minX: -5, minY: 295, maxX: 50, maxY: 345 }, 'contain')).toEqual([]);
    expect(hits.hitRect({ minX: -5, minY: 295, maxX: 105, maxY: 345 }, 'contain')).toEqual([
      'group-g',
    ]);
  });
});

describe('createSelectHitTester: entered groups', () => {
  const groupG = 'group-g' as ObjectId;
  const groupH = 'group-h' as ObjectId;

  it('selects at the entered level, and reports the level a press would take the tool to', () => {
    const hits = tester();
    // rect-e sits in group-h, inside group-g.
    expect(hits.hitPoint({ x: 70, y: 310 }, 1, groupG)).toEqual({
      id: groupH,
      part: 'object',
      scope: groupG,
    });
    expect(hits.hitPoint({ x: 70, y: 310 }, 1, groupH)).toEqual({
      id: 'rect-e',
      part: 'object',
      scope: groupH,
    });
    // rect-d, outside group-h, is at group-g's level; rect-a is outside every entered group.
    expect(hits.hitPoint({ x: 10, y: 310 }, 1, groupH)).toEqual({
      id: 'rect-d',
      part: 'object',
      scope: groupG,
    });
    expect(hits.hitPoint({ x: 10, y: 10 }, 1, groupH)).toEqual({
      id: 'rect-a',
      part: 'object',
      scope: null,
    });
  });

  it('marquees a group holding a locked object, as a click selects it', () => {
    const hits = tester((objects) =>
      objects.map((object) => (object.id === 'rect-e' ? { ...object, locked: true } : object)),
    );
    const everything = { minX: -10, minY: -30, maxX: 900, maxY: 600 };
    expect(hits.hitRect(everything, 'intersect')).toContain(groupG);
  });

  it('marquees only inside the entered group, at its level', () => {
    const hits = tester();
    const everything = { minX: -10, minY: -30, maxX: 900, maxY: 600 };
    expect([...hits.hitRect(everything, 'intersect', groupG)].sort()).toEqual(
      [groupH, 'rect-d'].sort(),
    );
    expect(hits.hitRect(everything, 'intersect', groupH)).toEqual(['rect-e']);
    expect(hits.hitRect(everything, 'intersect')).toContain(groupG);
  });
});

describe('createSelectHitTester: drop targets', () => {
  const withNestedFrame = (objects: BoardObject[]) => [
    ...objects,
    frame('frame-n', 'frame-f', { x: 150, y: 100, width: 100, height: 80 }),
  ];

  it('finds the top-most frame under a point, a nested frame over its parent', () => {
    const hits = tester(withNestedFrame);
    const always = () => true;
    expect(hits.frameAt({ x: 600, y: 150 }, always)).toBe('frame-n');
    expect(hits.frameAt({ x: 450, y: 150 }, always)).toBe('frame-f');
    // Over a child rectangle the frame under it still takes the object.
    expect(hits.frameAt({ x: 430, y: 30 }, always)).toBe('frame-f');
    expect(hits.frameAt({ x: 120, y: 20 }, always)).toBeUndefined();
  });

  it('skips the frames the caller refuses', () => {
    const hits = tester(withNestedFrame);
    expect(hits.frameAt({ x: 600, y: 150 }, (id) => id !== 'frame-n')).toBe('frame-f');
    expect(hits.frameAt({ x: 600, y: 150 }, () => false)).toBeUndefined();
  });
});
