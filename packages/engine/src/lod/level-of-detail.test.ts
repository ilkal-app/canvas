import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { LevelOfDetail, type LodCounters, type LodPass } from './level-of-detail.js';
import { lodFormOf } from './lod-form.js';
import type { LodForm } from './lod-rule.js';
import { IMAGE_LOD_RULE, TEXT_LOD_RULE } from './lod-thresholds.js';

/** A pass whose objects' size is their width: text-like forms (greek under 4, hidden under 2.5). */
const TEXT_LIKE: LodPass = {
  name: 'words',
  levelOfDetail: {
    rule: TEXT_LOD_RULE,
    sizeOf: (object) => ('width' in object ? object.width : 0),
  },
};
const IMAGE_LIKE: LodPass = {
  name: 'pictures',
  levelOfDetail: {
    rule: IMAGE_LOD_RULE,
    sizeOf: (object) => ('height' in object ? object.height : 0),
  },
};
const PLAIN: LodPass = { name: 'plain' };

const box = (id: string, width: number, height = 100): BoardObject =>
  shapeObject(id, { width, height });
const ids = (...names: string[]): ObjectId[] => names as ObjectId[];

function counters(): LodCounters {
  return { lodTransitions: 0, lodThrashes: 0 };
}

function withObjects(objects: readonly BoardObject[]): LevelOfDetail {
  const lod = new LevelOfDetail();
  lod.register([PLAIN, TEXT_LIKE, IMAGE_LIKE]);
  for (const object of objects) {
    lod.track(1, object);
    lod.track(2, object);
  }
  return lod;
}

describe('LevelOfDetail', () => {
  it('gives each object its form for the scale, remembered per object', () => {
    const lod = withObjects([box('small', 10), box('large', 40)]);
    lod.update(undefined, 0.35, counters());
    expect(lod.formOf('words', 'small' as ObjectId)).toBe('greek');
    expect(lod.formOf('words', 'large' as ObjectId)).toBe('full');
    lod.update(undefined, 0.2, counters());
    expect(lod.formOf('words', 'small' as ObjectId)).toBe('hidden');
    expect(lod.formOf('words', 'large' as ObjectId)).toBe('full');
    lod.update(undefined, 0.45, counters());
    // 4.5 px is in the band above 4 px: the small object stays greek; it was hidden and 4.5 px
    // is past 3 px, so it is greek again.
    expect(lod.formOf('words', 'small' as ObjectId)).toBe('greek');
    lod.update(undefined, 0.48, counters());
    expect(lod.formOf('words', 'small' as ObjectId)).toBe('full');
  });

  it('answers full for a pass without a rule and for an object it does not track', () => {
    const lod = withObjects([box('a', 1)]);
    lod.update(undefined, 1, counters());
    expect(lod.formOf('plain', 'a' as ObjectId)).toBe('full');
    expect(lod.formOf('words', 'missing' as ObjectId)).toBe('full');
    expect(lod.formOf('nowhere', 'a' as ObjectId)).toBe('full');
  });

  it('lists the objects whose form changed this frame, and counts only real transitions', () => {
    const lod = withObjects([box('a', 10), box('b', 100)]);
    const first = counters();
    lod.update(undefined, 0.3, first);
    // A first form is no transition, but a pass that drew it in full must hear of it.
    expect([...lod.changedIn('words')]).toEqual(ids('a'));
    expect(first).toEqual({ lodTransitions: 0, lodThrashes: 0 });
    const second = counters();
    lod.update(undefined, 0.5, second);
    expect([...lod.changedIn('words')]).toEqual(ids('a'));
    expect(second).toEqual({ lodTransitions: 1, lodThrashes: 0 });
    lod.update(undefined, 0.5, counters());
    expect(lod.changedIn('words').size).toBe(0);
  });

  it('evaluates only visible objects, and an object when it becomes visible', () => {
    const lod = withObjects([box('a', 10), box('b', 10)]);
    const visible = ids('a');
    lod.update(visible, 1, counters());
    lod.update(visible, 0.3, counters());
    expect(lod.formOf('words', 'a' as ObjectId)).toBe('greek');
    expect(lod.formOf('words', 'b' as ObjectId)).toBe('full');
    expect(lod.isVisible('b' as ObjectId)).toBe(false);
    const revision = lod.visibleRevision;
    lod.update(ids('a', 'b'), 0.3, counters());
    expect(lod.visibleRevision).toBe(revision + 1);
    expect(lod.enteredIds).toEqual(ids('b'));
    expect(lod.visibleIds).toEqual(ids('a', 'b'));
    expect(lod.isVisible('b' as ObjectId)).toBe(true);
    expect(lod.formOf('words', 'b' as ObjectId)).toBe('greek');
  });

  it('evaluates an entering object only once when zoom also crosses its size band', () => {
    const lod = new LevelOfDetail();
    lod.register([TEXT_LIKE]);
    lod.track(0, box('a', 10));
    lod.track(0, box('b', 10));
    lod.update(ids('a'), 1, counters());
    const before = lod.evaluations;
    const counts = counters();
    lod.update(ids('a', 'b'), 0.2, counts);
    expect(lod.evaluations - before).toBe(2);
    expect(lod.formOf('words', 'a' as ObjectId)).toBe('hidden');
    expect(lod.formOf('words', 'b' as ObjectId)).toBe('hidden');
    expect(counts).toEqual({ lodTransitions: 1, lodThrashes: 0 });
  });

  it('re-evaluates nothing on a zoom that crosses no threshold or band edge', () => {
    const lod = withObjects([box('a', 10), box('b', 30)]);
    lod.update(undefined, 1, counters());
    const before = lod.evaluations;
    lod.update(undefined, 1.1, counters());
    lod.update(undefined, 0.9, counters());
    expect(lod.evaluations).toBe(before);
    lod.update(undefined, 0.3, counters());
    expect(lod.evaluations).toBeGreaterThan(before);
  });

  it('keeps the hidden objects of each pass, bumping a revision when they change', () => {
    const lod = withObjects([box('a', 10, 100), box('b', 10, 1)]);
    lod.update(undefined, 1, counters());
    expect(lod.hiddenIn('words').size).toBe(0);
    const revision = lod.hiddenRevision;
    lod.update(undefined, 0.2, counters());
    expect([...lod.hiddenIn('words')].sort()).toEqual(ids('a', 'b'));
    expect(lod.hiddenRevision).toBeGreaterThan(revision);
    const afterHide = lod.hiddenRevision;
    lod.forget(1, 'a' as ObjectId);
    expect([...lod.hiddenIn('words')]).toEqual(ids('b'));
    expect(lod.hiddenRevision).toBeGreaterThan(afterHide);
    // The image-like pass has no hidden form.
    expect(lod.hiddenIn('pictures').size).toBe(0);
    expect(lod.formOf('pictures', 'b' as ObjectId)).toBe('average-color');
  });

  it('re-evaluates an object whose size changed at the next update', () => {
    const lod = withObjects([box('a', 100)]);
    lod.update(undefined, 0.3, counters());
    expect(lod.formOf('words', 'a' as ObjectId)).toBe('full');
    lod.track(1, box('a', 10));
    const frame = counters();
    lod.update(undefined, 0.3, frame);
    expect(lod.formOf('words', 'a' as ObjectId)).toBe('greek');
    expect(frame).toEqual({ lodTransitions: 1, lodThrashes: 0 });
  });

  it('never thrashes: a wobbling zoom changes each form at most once per traversal of its band, plus one', () => {
    const lod = withObjects([box('a', 10), box('b', 13), box('c', 17), box('d', 25)]);
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let scale = 0.3;
    let transitions = 0;
    for (let frame = 0; frame < 2_000; frame += 1) {
      scale = Math.min(0.6, Math.max(0.1, scale * (0.93 + 0.14 * random())));
      const frameCounters = counters();
      lod.update(undefined, scale, frameCounters);
      expect(frameCounters.lodThrashes).toBe(0);
      transitions += frameCounters.lodTransitions;
    }
    expect(transitions).toBeGreaterThan(0);
    for (const id of ids('a', 'b', 'c', 'd')) {
      for (const band of lod.historyOf('words', id).bands) {
        expect(band.transitions).toBeLessThanOrEqual(band.traversals + 1);
      }
    }
  });

  it('counts thrash for a rule without a band wobbling across a threshold, not for the real one', () => {
    const wobble = [0.5, 0.39, 0.41, 0.39, 0.41, 0.39, 0.41];
    const run = (pass: LodPass): { thrashes: number; transitions: number } => {
      const lod = new LevelOfDetail();
      lod.register([pass]);
      lod.track(0, box('a', 10));
      const total = counters();
      for (const scale of wobble) lod.update(undefined, scale, total);
      return { thrashes: total.lodThrashes, transitions: total.lodTransitions };
    };
    const noBand: LodPass = {
      name: 'words',
      levelOfDetail: {
        rule: { ...TEXT_LOD_RULE, hysteresis: 0 },
        sizeOf: (object) => ('width' in object ? object.width : 0),
      },
    };
    // 3.9 and 4.1 px: without a band every step crosses 4 px and flips the form; the band is
    // never traversed after the first fall from 5 px, so the third change is a thrash.
    expect(run(noBand)).toEqual({ thrashes: 4, transitions: 6 });
    // With its 20% band the text goes greek at 3.9 px and stays greek.
    expect(run(TEXT_LIKE)).toEqual({ thrashes: 0, transitions: 1 });
  });

  it('counts a traversal only when the size crosses the whole band', () => {
    const lod = withObjects([box('a', 10)]);
    // 5 px (above the band), 3.9 (under 4: greek), 4.5 (inside the band), 5 (above: full).
    for (const scale of [0.5, 0.39, 0.45, 0.5]) lod.update(undefined, scale, counters());
    const [greek, hidden] = lod.historyOf('words', 'a' as ObjectId).bands;
    expect(greek).toEqual({ side: 1, transitions: 2, traversals: 2 });
    // 2.5 px: never under it, so never traversed; 3.9 px is above its band (3 px).
    expect(hidden).toEqual({ side: 1, transitions: 0, traversals: 0 });
    expect(lod.historyOf('words', 'missing' as ObjectId)).toEqual({ transitions: 0, bands: [] });
  });

  it('agrees with evaluating every object every frame, over thousands of distinct sizes', () => {
    let seed = 11;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const objects = Array.from({ length: 2_000 }, (unused, index) =>
      box(`o${String(index)}`, 2 + random() * 60, 2 + random() * 60),
    );
    const lod = withObjects(objects);
    const expected = new Map<string, LodForm>();
    let scale = 0.3;
    let mismatches = 0;
    for (let frame = 0; frame < 200; frame += 1) {
      scale = Math.min(4, Math.max(0.02, scale * (0.8 + 0.4 * random())));
      lod.update(undefined, scale, counters());
      for (const object of objects) {
        const width = 'width' in object ? object.width : 0;
        const form = lodFormOf(TEXT_LOD_RULE, width * scale, expected.get(object.id));
        expected.set(object.id, form);
        if (lod.formOf('words', object.id) !== form) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('costs nothing per distinct size on a zoom that takes none across an edge', () => {
    const lod = withObjects(
      Array.from({ length: 5_000 }, (unused, index) => box(`o${String(index)}`, 100 + index * 0.1)),
    );
    lod.update(undefined, 1, counters());
    const before = lod.evaluations;
    for (let step = 1; step < 50; step += 1) lod.update(undefined, 1 + step * 0.01, counters());
    expect(lod.evaluations).toBe(before);
    // 0.04 to 0.05: the 100-unit to 600-unit widths cross 4 and 4.8 px here and there.
    lod.update(undefined, 0.04, counters());
    const far = lod.evaluations;
    lod.update(undefined, 0.041, counters());
    const crossed = lod.evaluations - far;
    expect(crossed).toBeGreaterThan(0);
    expect(crossed).toBeLessThan(500);
  });

  it('walks the visible objects, not every crossing size, when few are visible', () => {
    const objects = Array.from({ length: 5_000 }, (unused, index) =>
      box(`o${String(index)}`, 100 + index * 0.1),
    );
    const visible = ids('o0', 'o1000', 'o2500', 'o4999');
    const lod = withObjects(objects);
    const reference = withObjects(objects);
    lod.update(visible, 1, counters());
    reference.update(undefined, 1, counters());
    // Every width from 100 to 600 units crosses 4 px (and its band) between these scales.
    for (const scale of [0.05, 0.03, 0.006, 0.0066, 0.03, 0.2]) {
      const scanned = lod.crossingScans;
      lod.update(visible, scale, counters());
      expect(lod.crossingScans - scanned).toBeLessThanOrEqual(visible.length * 2);
      // The reference sees every object at every scale: the same forms, the slow way.
      reference.update(undefined, scale, counters());
      for (const id of visible) {
        expect(lod.formOf('words', id)).toBe(reference.formOf('words', id));
        expect(lod.formOf('pictures', id)).toBe(reference.formOf('pictures', id));
      }
    }
    // An object never visible keeps its first form.
    expect(lod.formOf('words', 'o1' as ObjectId)).toBe('full');
  });

  it('evaluates each crossing visible object once, and only them', () => {
    const lod = withObjects(
      Array.from({ length: 2_000 }, (unused, index) => box(`o${String(index)}`, 100 + index * 0.1)),
    );
    const visible = ids('o0', 'o10', 'o20');
    lod.update(visible, 1, counters());
    const before = lod.evaluations;
    const counts = counters();
    lod.update(visible, 0.03, counts);
    // 100–102 units cross 4 px (words) and 8 px (pictures) between 1 and 0.03.
    expect(lod.evaluations - before).toBe(6);
    expect(counts.lodTransitions).toBe(6);
    expect(lod.formOf('words', 'o30' as ObjectId)).toBe('full');
  });

  it('measures an object again only when its rule cannot tell the size is the same', () => {
    let measured = 0;
    const lod = new LevelOfDetail();
    lod.register([
      {
        name: 'counted',
        levelOfDetail: {
          rule: TEXT_LOD_RULE,
          sizeOf: (object) => {
            measured += 1;
            return 'width' in object ? object.width : 0;
          },
          isSameSize: (previous, next) =>
            'width' in previous && 'width' in next && previous.width === next.width,
        },
      },
    ]);
    lod.track(0, box('a', 10));
    expect(measured).toBe(1);
    for (let step = 1; step <= 5; step += 1) lod.track(0, { ...box('a', 10), x: step, y: -step });
    expect(measured).toBe(1);
    lod.track(0, { ...box('a', 30), x: 5 });
    expect(measured).toBe(2);
    lod.update(undefined, 0.3, counters());
    // 30 units at 0.3: 9 px, in full; the move after it kept the resized size.
    expect(lod.formOf('counted', 'a' as ObjectId)).toBe('full');
    // A rule that cannot tell measures on every change.
    const plain = withObjects([box('b', 10)]);
    plain.track(1, { ...box('b', 10), x: 3 });
    plain.update(undefined, 0.3, counters());
    expect(plain.formOf('words', 'b' as ObjectId)).toBe('greek');
  });
});
