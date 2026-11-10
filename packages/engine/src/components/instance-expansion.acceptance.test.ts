// Acceptance, second slice: the
// engine's `InstanceExpansion` turns shown instances into transient virtual objects at the
// change-set boundary, never writing the document, so every scene consumer reads them as ordinary
// objects. Each case drives the expansion as the app's feed does and holds the main-thread mirror
// and the worker's `SceneSourceMirror` to the oracle: the shown real objects plus
// `resolveInstance` over the whole board. Written before the product code.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import {
  cardMain,
  component,
  ComponentBoard,
  ExpansionHarness,
  expectedScene,
  id,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

function attached(objects: readonly BoardObject[], page?: string): ExpansionHarness {
  const harness = new ExpansionHarness(
    new ComponentBoard(objects, page),
    expectedExport('InstanceExpansion'),
  );
  harness.step();
  return harness;
}

describe('InstanceExpansion: transient virtual objects', () => {
  it('shows each instance as its main’s content under virtual ids, writing nothing', () => {
    const objects = [...cardMain(), instance('inst', 'main', { x: 400 })];
    const harness = attached(objects);
    harness.expectScene();
    expect(harness.mirror.get('inst/title')).toMatchObject({ id: 'inst/title', parentId: 'inst' });
    expect(harness.mirror.get('inst/dot')).toMatchObject({ parentId: 'inst/badge' });
    expect(harness.mirror.get('inst/link')).toMatchObject({
      from: { kind: 'object', objectId: 'inst/title' },
      to: { kind: 'object', objectId: 'inst/note' },
    });
    expect(harness.mirror.get('inst')).toEqual(harness.board.objects.get(id('inst')));
    expect([...harness.board.objects.values()]).toEqual(objects);
    expect(harness.expansion.virtualCount).toBe(7);
  });

  it('answers the owner of virtual and real ids, and recognises virtual ids', () => {
    const isVirtualObjectId = expectedExport('isVirtualObjectId');
    const harness = attached([...cardMain(), instance('inst', 'main')]);
    expect(harness.expansion.ownerOf('inst/dot')).toBe('inst');
    expect(harness.expansion.ownerOf('inst')).toBe('inst');
    expect(harness.expansion.ownerOf('title')).toBe('title');
    expect(harness.expansion.ownerOf('nowhere')).toBeUndefined();
    expect(harness.expansion.ownerOf('nowhere/title')).toBeUndefined();
    expect(isVirtualObjectId('inst/title')).toBe(true);
    expect(isVirtualObjectId('inst')).toBe(false);
    expect(harness.expansion.statusOf(id('inst'))).toEqual({
      isMainRetired: false,
      isEmpty: false,
    });
    expect(harness.expansion.statusOf(id('title'))).toBeUndefined();
  });

  it('expands a real instance nested inside a shown main, owned by itself', () => {
    const objects = [
      ...cardMain(),
      component('outer', { x: 0, y: 300 }),
      instance('nested', 'main', { parentId: 'outer', x: 0, y: 0 }),
      instance('top', 'outer', { x: 400, y: 300 }),
    ];
    const harness = attached(objects);
    harness.expectScene();
    expect(harness.expansion.ownerOf('nested/title')).toBe('nested');
    expect(harness.expansion.ownerOf('top/nested/title')).toBe('top');
    expect(harness.mirror.get('top/nested/title')).toMatchObject({ parentId: 'top/nested' });
  });

  it('follows overrides set and reset, and hides an overridden-hidden subtree', () => {
    const harness = attached([...cardMain(), instance('inst', 'main')]);
    harness.board.update('inst', {
      overrides: {
        note: { text: 'Changed', color: [0.2, 0.8, 0.4, 1] },
        title: { fill: [1, 0, 0, 1] },
        photo: { assetId: 'asset-other' },
        badge: { isHidden: true },
      },
    });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('inst/badge')).toBe(false);
    expect(harness.mirror.has('inst/dot')).toBe(false);
    expect(harness.mirror.get('inst/note')).toMatchObject({ text: 'Changed' });
    harness.board.update('inst', { overrides: {} });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('inst/dot')).toMatchObject({ parentId: 'inst/badge' });
  });

  it('applies the main children’s constraints at the instance’s own size', () => {
    const harness = attached([...cardMain(), instance('inst', 'main')]);
    harness.board.update('title', { constraints: { x: 'stretch', y: 'start' } });
    harness.board.update('photo', { constraints: { x: 'end', y: 'center' } });
    harness.step();
    harness.board.update('inst', { width: 300, height: 160 });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('inst/title')).toMatchObject({ x: 10, width: 280 });
    expect(harness.mirror.get('inst/photo')).toMatchObject({ x: 210, y: 70 });
  });

  it('re-resolves nothing when an instance only moves, rotates or restacks', () => {
    const harness = attached([...cardMain(), instance('inst', 'main')]);
    const before = harness.outputs.length;
    harness.board.update('inst', { x: 900, y: -40, rotation: 0.5, z: 'b0' });
    harness.step();
    harness.expectScene();
    expect([...harness.listedSince(before)]).toEqual(['inst']);
  });

  it('lists every dropped virtual id when an instance is deleted', () => {
    const harness = attached([...cardMain(), instance('inst', 'main')]);
    const before = harness.outputs.length;
    harness.board.remove('inst');
    harness.step();
    harness.expectScene();
    const listed = harness.listedSince(before);
    for (const key of ['inst', 'inst/title', 'inst/dot', 'inst/link'])
      expect(listed.has(key)).toBe(true);
    expect(harness.expansion.ownerOf('inst/title')).toBeUndefined();
    expect(harness.expansion.virtualCount).toBe(0);
  });
});

describe('InstanceExpansion: placeholders and retired mains', () => {
  it('draws a placeholder, never silence, for each reference issue', () => {
    const objects = [
      instance('lost', 'nowhere'),
      shape('plain', null, { x: 300 }),
      instance('wrong', 'plain', { x: 600 }),
    ];
    const harness = attached(objects);
    harness.expectScene(['lost', 'wrong']);
    expect(harness.expansion.statusOf(id('lost'))).toEqual({
      issue: 'missing-main',
      isMainRetired: false,
      isEmpty: true,
    });
    expect(harness.expansion.statusOf(id('wrong'))).toMatchObject({
      issue: 'invalid-main',
      isEmpty: true,
    });
  });

  it('shows the content resolved before a cycle or depth limit, with a placeholder', () => {
    const chain: BoardObject[] = [shape('leaf', 'm1')];
    for (let level = 1; level <= 6; level += 1) {
      chain.push(component(`m${String(level)}`, { x: level * 300 }));
      if (level < 6)
        chain.push(
          instance(`i${String(level)}`, `m${String(level)}`, { parentId: `m${String(level + 1)}` }),
        );
    }
    chain.push(instance('deep', 'm6', { y: 400 }));
    const cycle = [
      component('ca'),
      component('cb', { x: 300 }),
      instance('a-in-b', 'ca', { parentId: 'cb' }),
      instance('b-in-a', 'cb', { parentId: 'ca' }),
      instance('looped', 'ca', { y: 800 }),
    ];
    const harness = attached([...chain, ...cycle]);
    expect(harness.expansion.statusOf(id('deep'))).toMatchObject({ issue: 'instance-depth' });
    expect(harness.expansion.statusOf(id('looped'))).toMatchObject({ issue: 'instance-cycle' });
    const scene = expectedScene(harness.board);
    for (const key of scene.keys()) expect(harness.mirror.get(key)).toEqual(scene.get(key));
    for (const owner of ['deep', 'looped']) {
      const extra = [...harness.mirror.keys()].filter(
        (key) => !scene.has(key) && harness.expansion.ownerOf(key) === owner,
      );
      expect(extra.length).toBeGreaterThan(0);
    }
  });

  it('leaves a retired main and its subtree out, keeps a late instance’s content, and shows an empty retired main’s placeholder', () => {
    const objects = [
      ...cardMain(),
      instance('late', 'main', { x: 400 }),
      component('hollow', { retired: true, y: 300 }),
      instance('empty', 'hollow', { x: 400, y: 300 }),
    ];
    const harness = attached(objects);
    harness.board.update('main', { retired: true });
    harness.step();
    harness.expectScene(['empty']);
    for (const key of ['main', 'title', 'dot', 'hollow'])
      expect(harness.mirror.has(key)).toBe(false);
    expect(harness.mirror.get('late/title')).toMatchObject({ parentId: 'late' });
    expect(harness.expansion.statusOf(id('late'))).toEqual({ isMainRetired: true, isEmpty: false });
    expect(harness.expansion.statusOf(id('empty'))).toEqual({ isMainRetired: true, isEmpty: true });
    harness.board.update('main', { retired: false });
    harness.step();
    harness.expectScene(['empty']);
    expect(harness.mirror.get('dot')).toBeDefined();
  });

  it('reports an active empty main as empty without an issue', () => {
    const harness = attached([component('blank'), instance('inst', 'blank', { x: 400 })]);
    expect(harness.expansion.statusOf(id('inst'))).toEqual({ isMainRetired: false, isEmpty: true });
    const scene = expectedScene(harness.board);
    for (const key of scene.keys()) expect(harness.mirror.get(key)).toEqual(scene.get(key));
  });
});
