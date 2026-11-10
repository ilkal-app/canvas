import { describe, expect, it } from 'vitest';

import { BODY, OUTLINE, shape, sticky } from './__fixtures__/component-board.js';
import { byId, fullBoard, idsOf, RED, resolve } from './__fixtures__/resolved-board.js';

// Acceptance: what an instance's override records may change in the resolved objects, and
// what stays the main's so a later main edit reaches every instance.

describe('resolveInstance overrides', () => {
  it('replaces the text of a sticky and keeps the main’s run style over the new characters', () => {
    const board = fullBoard({ overrides: { sticky: { text: 'Hello', color: RED } } });
    const resolved = byId(resolve(board).objects, 'inst/sticky');
    expect(resolved).toMatchObject({
      text: 'Hello',
      runs: [{ length: 5, style: BODY }],
      color: RED,
      type: 'sticky',
    });
  });

  it('clips the source runs to shorter text and extends the last run over added characters', () => {
    const bold = { ...BODY, weight: 700 };
    const runs = [
      { length: 2, style: BODY },
      { length: 2, style: bold },
    ];
    const withText = (text: string) =>
      byId(
        resolve(
          fullBoard({ overrides: { sticky: { text } } }, [
            sticky('sticky', 'main', { x: 30, y: 40, z: 'a2', runs }),
          ]),
        ).objects,
        'inst/sticky',
      );
    expect(withText('N').runs).toEqual([{ length: 1, style: BODY }]);
    expect(withText('No').runs).toEqual([{ length: 2, style: BODY }]);
    expect(withText('Notebook').runs).toEqual([
      { length: 2, style: BODY },
      { length: 6, style: bold },
    ]);
    expect(withText('').runs).toEqual([{ length: 0, style: BODY }]);
  });

  it('moves a run boundary forward to a character boundary of the new text', () => {
    const bold = { ...BODY, weight: 700 };
    const runs = [
      { length: 1, style: BODY },
      { length: 3, style: bold },
    ];
    const board = fullBoard({ overrides: { sticky: { text: '\u{1F600}ab' } } }, [
      sticky('sticky', 'main', { x: 30, y: 40, z: 'a2', runs }),
    ]);
    const resolved = byId(resolve(board).objects, 'inst/sticky');
    expect(resolved.text).toBe('\u{1F600}ab');
    expect(resolved.runs).toEqual([
      { length: 2, style: BODY },
      { length: 2, style: bold },
    ]);
  });

  it('replaces the text of a shape label in its style, and ignores text on a shape without one', () => {
    const board = fullBoard({
      overrides: { 'child-a': { text: 'Bee' }, 'child-b': { text: 'no' } },
    });
    const { objects } = resolve(board);
    expect(byId(objects, 'inst/child-a').label).toEqual({
      text: 'Bee',
      runs: [{ length: 3, style: BODY }],
    });
    expect(byId(objects, 'inst/child-b').label).toBeNull();
  });

  it('recolours a stroke keeping the main’s width, and ignores strokeColor where there is none', () => {
    const board = fullBoard(
      {
        overrides: { 'child-a': { strokeColor: RED, fill: RED }, 'child-b': { strokeColor: RED } },
      },
      [
        shape('child-a', 'main', { x: 30, y: 10, z: 'a0' }),
        shape('child-b', 'main', { x: 100, y: 10, z: 'a1', stroke: null }),
      ],
    );
    const { objects } = resolve(board);
    expect(byId(objects, 'inst/child-a')).toMatchObject({
      stroke: { ...OUTLINE, color: RED },
      fill: RED,
      x: 30,
      y: 10,
    });
    expect(byId(objects, 'inst/child-b').stroke).toBeNull();
  });

  it('lets a later main change of font size and stroke width reach an overridden instance', () => {
    const overrides = { sticky: { text: 'Hello' }, 'child-a': { strokeColor: RED } };
    const before = resolve(fullBoard({ overrides })).objects;
    expect(byId(before, 'inst/sticky').runs).toEqual([{ length: 5, style: BODY }]);
    expect(byId(before, 'inst/child-a').stroke).toEqual({ ...OUTLINE, color: RED });
    const larger = { ...BODY, fontSize: 40 };
    const after = resolve(
      fullBoard({ overrides }, [
        sticky('sticky', 'main', { x: 30, y: 40, z: 'a2', runs: [{ length: 4, style: larger }] }),
        shape('child-a', 'main', { x: 30, y: 10, z: 'a0', stroke: { ...OUTLINE, width: 7 } }),
      ]),
    ).objects;
    expect(byId(after, 'inst/sticky')).toMatchObject({
      text: 'Hello',
      runs: [{ length: 5, style: larger }],
    });
    expect(byId(after, 'inst/child-a').stroke).toEqual({ color: RED, width: 7 });
  });

  it('replaces the asset, natural size and crop of an image', () => {
    const naturalSize = { width: 50, height: 40 };
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const board = fullBoard({
      overrides: { image: { assetId: 'asset-other', naturalSize, crop } },
    });
    const resolved = byId(resolve(board).objects, 'inst/image');
    expect(resolved).toMatchObject({ assetId: 'asset-other', naturalSize, crop, width: 20 });
  });

  it('omits a hidden child and its subtree', () => {
    const board = fullBoard({
      overrides: { group: { isHidden: true }, 'child-b': { isHidden: true } },
    });
    const ids = idsOf(resolve(board).objects);
    expect(ids).not.toContain('inst/group');
    expect(ids).not.toContain('inst/grouped');
    expect(ids).not.toContain('inst/child-b');
    expect(ids).toContain('inst/child-a');
  });

  it('applies an override at path child to a child inside a group or a frame of the main', () => {
    const board = fullBoard({ overrides: { grouped: { fill: RED }, framed: { fill: RED } } });
    const { objects } = resolve(board);
    expect(byId(objects, 'inst/grouped')).toMatchObject({ fill: RED, parentId: 'inst/group' });
    expect(byId(objects, 'inst/framed')).toMatchObject({ fill: RED, parentId: 'inst/inner' });
  });

  it('ignores a field the child type does not take, without throwing, and applies the rest', () => {
    const board = fullBoard({
      overrides: { 'child-a': { color: RED, fill: RED }, image: { text: 'nope' } },
    });
    const { objects } = resolve(board);
    const resolvedShape = byId(objects, 'inst/child-a');
    expect(resolvedShape.fill).toEqual(RED);
    expect(Object.keys(resolvedShape)).not.toContain('color');
    const resolvedImage = byId(objects, 'inst/image');
    expect(Object.keys(resolvedImage)).not.toContain('text');
    expect(resolvedImage).toMatchObject({ assetId: 'asset-photo', x: 120, y: 40 });
  });
});
