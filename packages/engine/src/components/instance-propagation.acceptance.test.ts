// Acceptance, second slice: main
// edits reach every shown instance, on whatever page the main is, including edits the board no
// longer records once made (a deleted child, a child moved out, a hard-removed main), through
// nested instances, with the instance's overrides kept; a page switch swaps the virtual objects
// with the real ones. Both mirrors equal the oracle after every step.
import { describe, expect, it } from 'vitest';

import {
  BODY,
  cardMain,
  component,
  ComponentBoard,
  ExpansionHarness,
  frame,
  id,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

/**
 * The card main and an instance `a1` on page A; on page B, instance `b1` at the root and `b2`
 * inside a frame, with an image override; page B shown.
 *
 * @returns The harness, attached.
 */
function crossPage(): ExpansionHarness {
  const objects = [
    ...cardMain('page-a'),
    instance('a1', 'main', { pageId: 'page-a', x: 400 }),
    instance('b1', 'main', { pageId: 'page-b' }),
    frame('holder', null, { pageId: 'page-b', x: 400, width: 300, height: 200 }),
    instance('b2', 'main', {
      parentId: 'holder',
      x: 20,
      y: 20,
      overrides: { photo: { assetId: 'asset-override' } },
    }),
  ];
  const harness = new ExpansionHarness(
    new ComponentBoard(objects, 'page-b'),
    expectedExport('InstanceExpansion'),
  );
  harness.step();
  return harness;
}

describe('InstanceExpansion: main edits on another page', () => {
  it('resolves instances whose main is on a page the view does not show', () => {
    const harness = crossPage();
    harness.expectScene();
    expect(harness.mirror.has('title')).toBe(false);
    expect(harness.mirror.get('b2/title')).toMatchObject({ parentId: 'b2' });
  });

  it('updates exactly the shown dependents when a main child changes', () => {
    const harness = crossPage();
    const before = harness.outputs.length;
    harness.board.update('title', { fill: [0, 0.5, 0, 1] });
    harness.step();
    harness.expectScene();
    const listed = harness.listedSince(before);
    expect(listed.has('b1/title') && listed.has('b2/title')).toBe(true);
    expect([...listed].filter((key) => key.startsWith('a1'))).toEqual([]);
  });

  it('carries a main font change into an overridden text, keeping the override', () => {
    const harness = crossPage();
    harness.board.update('b1', { overrides: { caption: { text: 'Hello' } } });
    harness.step();
    harness.board.update('caption', {
      runs: [{ length: 2, style: { ...BODY, fontSize: 32, weight: 700 } }],
    });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('b1/caption')).toMatchObject({
      text: 'Hello',
      runs: [{ length: 5, style: { fontSize: 32, weight: 700 } }],
    });
    expect(harness.mirror.get('b2/caption')).toMatchObject({
      text: 'Hi',
      runs: [{ length: 2, style: { fontSize: 32 } }],
    });
  });

  it('carries a main image change to instances without an image override only', () => {
    const harness = crossPage();
    harness.board.update('photo', { assetId: 'asset-new', naturalSize: { width: 64, height: 32 } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('b1/photo')).toMatchObject({ assetId: 'asset-new' });
    expect(harness.mirror.get('b2/photo')).toMatchObject({ assetId: 'asset-override' });
  });

  it('carries constraint and main-size changes into a resized instance', () => {
    const harness = crossPage();
    harness.board.update('b1', { width: 400 });
    harness.step();
    harness.board.update('note', { constraints: { x: 'stretch', y: 'start' } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('b1/note')).toMatchObject({ x: 10, width: 240 });
    harness.board.update('main', { width: 300 });
    harness.board.update('note', { width: 140 });
    harness.step();
    harness.expectScene();
  });

  it('adds a new main child to every shown instance', () => {
    const harness = crossPage();
    harness.board.add(shape('extra', 'main', { x: 170, y: 70, z: 'a9' }));
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('b2/extra')).toMatchObject({ parentId: 'b2' });
  });
});

describe('InstanceExpansion: edits the board no longer records', () => {
  it('drops a deleted main child from every shown instance', () => {
    const harness = crossPage();
    harness.board.remove('note');
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('b1/note') || harness.mirror.has('b2/note')).toBe(false);
  });

  it('drops a deleted subtree of a main', () => {
    const harness = crossPage();
    harness.board.remove('badge', 'dot');
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('b1/dot')).toBe(false);
  });

  it('drops a child moved out of the main, and gives it to the main it moved into', () => {
    const harness = crossPage();
    harness.board.add(
      component('other', { pageId: 'page-a', y: 400 }),
      instance('c1', 'other', { pageId: 'page-b', y: 400 }),
    );
    harness.step();
    harness.board.update('caption', { parentId: null, pageId: 'page-a', x: 600 });
    harness.board.update('photo', { parentId: 'other' });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('b1/caption') || harness.mirror.has('b1/photo')).toBe(false);
    expect(harness.mirror.get('c1/photo')).toMatchObject({ parentId: 'c1' });
  });

  it('turns instances of a main removed outright into placeholders', () => {
    const harness = crossPage();
    harness.board.remove('main', 'title', 'note', 'caption', 'photo', 'badge', 'dot', 'link');
    harness.step();
    harness.expectScene(['b1', 'b2']);
    expect(harness.expansion.statusOf(id('b1'))).toMatchObject({
      issue: 'missing-main',
      isEmpty: true,
    });
  });

  it('keeps rendering a retired main for its instances on another page', () => {
    const harness = crossPage();
    harness.board.update('main', { retired: true });
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('b1'))).toEqual({ isMainRetired: true, isEmpty: false });
  });

  it('follows edits through a nested instance, and drops the nested instance when it is deleted', () => {
    const harness = crossPage();
    harness.board.add(
      component('outer', { pageId: 'page-a', y: 600 }),
      instance('nested', 'main', { parentId: 'outer' }),
      instance('top', 'outer', { pageId: 'page-b', y: 600 }),
    );
    harness.step();
    harness.board.update('title', { fill: [0.5, 0, 0.5, 1] });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('top/nested/title')).toMatchObject({ fill: [0.5, 0, 0.5, 1] });
    harness.board.remove('nested');
    harness.step();
    harness.expectScene();
    expect([...harness.mirror.keys()].filter((key) => key.startsWith('top/'))).toEqual([]);
  });
});

describe('InstanceExpansion: page switches', () => {
  it('swaps one page’s virtual objects for the other’s, both ways', () => {
    const harness = crossPage();
    harness.board.show('page-a');
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('b1/title')).toBe(false);
    expect(harness.mirror.get('a1/title')).toMatchObject({ parentId: 'a1' });
    expect(harness.mirror.get('title')).toBeDefined();
    expect(harness.expansion.ownerOf('b1/title')).toBeUndefined();
    harness.board.update('title', { fill: [0, 0, 1, 1] });
    harness.step();
    harness.board.show('page-b');
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('b1/title')).toMatchObject({ fill: [0, 0, 1, 1] });
  });
});
