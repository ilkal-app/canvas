import { describe, expect, it } from 'vitest';

import type { Shadow } from '@canvas/schema';

import {
  BOB,
  BODY,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';
import { setTextRunsCommand } from './set-text-runs.js';

describe('setStyle', () => {
  it("sets each object type's own appearance fields and nothing else", () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'shape-box', style: { kind: 'ellipse', stroke: null, fill: [1, 0, 0, 1] } },
        { id: 'line-divider', style: { endCap: 'arrow', route: 'elbow' } },
        { id: 'frame-plan', style: { background: null, clip: false } },
        { id: 'image-photo', style: { opacity: 0.25 } },
      ],
    });
    expect(result).toEqual({
      styledIds: ['shape-box', 'line-divider', 'frame-plan', 'image-photo'],
    });
    expectDiff(before, store.read(), changes, {
      updated: ['frame-plan', 'image-photo', 'line-divider', 'shape-box'],
    });
    expect(mustGet(store, 'shape-box')).toEqual({
      ...fixtureObject('shape-box', 'shape'),
      kind: 'ellipse',
      stroke: null,
      fill: [1, 0, 0, 1],
      updatedAt: NOW,
    });
    expect(mustGet(store, 'line-divider')).toMatchObject({ endCap: 'arrow', route: 'elbow' });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ background: null, clip: false });
    expect(mustGet(store, 'image-photo')).toMatchObject({ opacity: 0.25, updatedAt: NOW });
  });

  it('crops an image, its box following the crop so what stays shown does not move', () => {
    const store = createFixtureStore();
    const before = store.read();
    const crop = { x: 0.3, y: 0.5, width: 0.4, height: 0.5 };
    const { result, changes } = applyCommand(store, setStyleCommand, {
      changes: [{ id: 'image-photo', style: { crop, opacity: 0.5 } }],
    });
    expect(result).toEqual({ styledIds: ['image-photo'] });
    expectDiff(before, store.read(), changes, { updated: ['image-photo'] });
    expect(mustGet(store, 'image-photo')).toEqual({
      ...fixtureObject('image-photo', 'image'),
      crop,
      opacity: 0.5,
      x: 1000,
      y: -150,
      width: 200,
      height: 150,
      updatedAt: NOW,
    });
  });

  it('refuses a crop outside the image or empty, and a crop of anything but an image', () => {
    const store = createFixtureStore();
    for (const crop of [
      { x: 0.5, y: 0, width: 0.6, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: -0.1, y: 0, width: 0.5, height: 1 },
    ]) {
      const codes = expectRejected(store, setStyleCommand, {
        changes: [{ id: 'image-photo', style: { crop } }],
      }).map((error) => error.code);
      expect(codes).toEqual(['invalid-input']);
    }
    const errors = expectRejected(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { crop: { x: 0, y: 0, width: 1, height: 1 } } }],
    });
    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ['unsupported-type', ['changes', 0, 'style', 'crop']],
    ]);
  });

  it('sets a frame’s showName either way, stored in its style and read back', () => {
    const store = createFixtureStore();
    // An absent showName reads as undefined, as the store reads every optional field.
    expect(mustGet(store, 'frame-plan')).toMatchObject({ showName: undefined });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { showName: false } }],
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ showName: false, updatedAt: NOW });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { showName: true } }],
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ showName: true, name: 'Launch plan' });
    expect(store.read().issues).toEqual([]);
  });

  it('refuses showName that is not a boolean, or on anything but a frame', () => {
    const store = createFixtureStore();
    for (const showName of ['yes', null, 1]) {
      const codes = expectRejected(store, setStyleCommand, {
        changes: [{ id: 'frame-plan', style: { showName } }],
      }).map((error) => error.code);
      expect(codes).toEqual(['invalid-input']);
    }
    const errors = expectRejected(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { showName: true } }],
    });
    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ['unsupported-type', ['changes', 0, 'style', 'showName']],
    ]);
  });

  it('sets, changes and removes a shape’s or frame’s drop shadow', () => {
    const store = createFixtureStore();
    expect(mustGet(store, 'shape-box')).toMatchObject({ shadow: undefined });
    const shadow: Shadow = { x: 2, y: 6, blur: 12, spread: -1, color: [0, 0, 0.2, 0.4] };
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'shape-box', style: { shadow } },
        { id: 'frame-plan', style: { shadow: { ...shadow, x: -4 } } },
      ],
    });
    expect(mustGet(store, 'shape-box')).toMatchObject({ shadow, updatedAt: NOW });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ shadow: { ...shadow, x: -4 } });
    // Null turns it off: a style patch cannot remove a field.
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { shadow: null } }],
    });
    expect(mustGet(store, 'shape-box')).toMatchObject({ shadow: null });
    expect(store.read().issues).toEqual([]);
  });

  it('refuses a shadow out of range, in ink, or on a type without one', () => {
    const store = createFixtureStore();
    const shadow = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };
    for (const bad of [{ ...shadow, blur: -1 }, { ...shadow, color: 'ink' }, { x: 1 }, 'soft']) {
      const codes = expectRejected(store, setStyleCommand, {
        changes: [{ id: 'shape-box', style: { shadow: bad } }],
      }).map((error) => error.code);
      expect(new Set(codes)).toEqual(new Set(['invalid-input']));
    }
    const errors = expectRejected(store, setStyleCommand, {
      changes: [{ id: 'line-divider', style: { shadow } }],
    });
    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ['unsupported-type', ['changes', 0, 'style', 'shadow']],
    ]);
  });

  it('sets a shape’s stroke alignment, and a frame’s outline and alignment', () => {
    const store = createFixtureStore();
    expect(mustGet(store, 'shape-box')).toMatchObject({ strokeAlign: undefined });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ stroke: undefined });
    const stroke = { color: 'ink' as const, width: 2 };
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'shape-box', style: { strokeAlign: 'outside' } },
        { id: 'frame-plan', style: { stroke, strokeAlign: 'center' } },
      ],
    });
    expect(mustGet(store, 'shape-box')).toMatchObject({ strokeAlign: 'outside', updatedAt: NOW });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ stroke, strokeAlign: 'center' });
    // Null turns a frame's outline off: a style patch cannot remove a field.
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { stroke: null } }],
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ stroke: null, strokeAlign: 'center' });
    expect(store.read().issues).toEqual([]);
  });

  it('refuses an unknown alignment, and an alignment on a type without one', () => {
    const store = createFixtureStore();
    for (const bad of ['middle', null, 1]) {
      const codes = expectRejected(store, setStyleCommand, {
        changes: [{ id: 'shape-box', style: { strokeAlign: bad } }],
      }).map((error) => error.code);
      expect(new Set(codes)).toEqual(new Set(['invalid-input']));
    }
    const errors = expectRejected(store, setStyleCommand, {
      changes: [{ id: 'line-divider', style: { strokeAlign: 'outside' } }],
    });
    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ['unsupported-type', ['changes', 0, 'style', 'strokeAlign']],
    ]);
    const wide = expectRejected(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { stroke: { color: 'ink', width: 65 } } }],
    });
    expect(new Set(wide.map((error) => error.code))).toEqual(new Set(['invalid-input']));
  });

  it('sets text style fields on a whole text body and on a label', () => {
    const store = createFixtureStore();
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'text-title', style: { align: 'center', textStyle: { fontSize: 30 } } },
        { id: 'shape-box', style: { textStyle: { weight: 700 } } },
      ],
    });
    // The title's two runs keep their own weight and colour; only the size changes.
    expect(mustGet(store, 'text-title')).toMatchObject({
      align: 'center',
      runs: [
        { length: 12, style: { ...BODY, weight: 700, fontSize: 30 } },
        { length: 2, style: { ...BODY, fontSize: 30, color: [0.8, 0.1, 0.1, 1] } },
      ],
    });
    expect(mustGet(store, 'shape-box')).toMatchObject({
      label: { text: 'API', runs: [{ length: 3, style: { ...BODY, weight: 700 } }] },
    });
  });

  it('restyles the style empty text types in', () => {
    const store = createFixtureStore();
    applyCommand(store, setTextRunsCommand, {
      id: 'sticky-idea',
      text: '',
      runs: [{ length: 0, style: BODY }],
    });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'sticky-idea', style: { textStyle: { italic: true } } }],
    });
    expect(mustGet(store, 'sticky-idea')).toMatchObject({
      text: '',
      runs: [{ length: 0, style: { ...BODY, italic: true } }],
    });
  });

  it('writes texts’ and stickies’ measured sizes with their restyle, in one change set', () => {
    const store = createFixtureStore();
    const before = store.read();
    let changeSets = 0;
    const stop = store.subscribe(() => (changeSets += 1));
    const { result, changes } = applyCommand(store, setStyleCommand, {
      changes: [
        {
          id: 'text-title',
          style: { textStyle: { fontSize: 30 } },
          size: { width: 312.5, height: 40 },
        },
        {
          id: 'sticky-idea',
          style: { textStyle: { italic: true } },
          size: { width: 200, height: 90 },
        },
        { id: 'shape-box', style: { fill: null } },
      ],
    });
    stop();
    expect(changeSets).toBe(1);
    expect(result).toEqual({ styledIds: ['text-title', 'sticky-idea', 'shape-box'] });
    expectDiff(before, store.read(), changes, {
      updated: ['shape-box', 'sticky-idea', 'text-title'],
    });
    expect(mustGet(store, 'text-title')).toMatchObject({ width: 312.5, height: 40 });
    expect(mustGet(store, 'sticky-idea')).toMatchObject({ width: 200, height: 90 });
    expect(mustGet(store, 'shape-box')).toMatchObject({
      width: fixtureObject('shape-box', 'shape').width,
      fill: null,
    });
  });

  it('refuses a size for a label and a size that is not positive, writing nothing', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, setStyleCommand, {
      changes: [
        { id: 'text-title', style: { align: 'right' }, size: { width: 10, height: 10 } },
        {
          id: 'shape-box',
          style: { textStyle: { italic: true } },
          size: { width: 10, height: 10 },
        },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['unsupported-type', 'shape-box', ['changes', 1, 'size']],
    ]);
    for (const size of [{ width: 0, height: 10 }, { width: 10, height: -1 }, { width: 10 }]) {
      const codes = expectRejected(store, setStyleCommand, {
        changes: [{ id: 'text-title', style: { align: 'right' }, size }],
      }).map((error) => error.code);
      expect(codes).toEqual(['invalid-input']);
    }
  });

  it('rejects fields the object type does not take, and labels that do not exist', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, setStyleCommand, {
      changes: [
        { id: 'sticky-idea', style: { fill: [1, 1, 1, 1], color: [1, 1, 1, 1] } },
        { id: 'shape-star', style: { textStyle: { italic: true } } },
        { id: 'video-demo', style: { opacity: 1 } },
        { id: 'image-photo', style: { textStyle: { italic: true } } },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['unsupported-type', 'sticky-idea', ['changes', 0, 'style', 'fill']],
      ['unsupported-type', 'shape-star', ['changes', 1, 'style', 'textStyle']],
      ['unsupported-type', 'video-demo', ['changes', 2, 'style', 'opacity']],
      ['unsupported-type', 'image-photo', ['changes', 3, 'style', 'textStyle']],
    ]);
  });

  it('rejects values the object type refuses, and empty or malformed style patches', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, setStyleCommand, {
      changes: [
        { id: 'line-divider', style: { route: 'curved', stroke: null } },
        { id: 'gone', style: { opacity: 1 } },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-object', 'gone', ['changes', 1]],
      ['invalid-object', 'line-divider', ['route']],
      ['invalid-object', 'line-divider', ['stroke']],
    ]);
    const codesOf = (style: unknown) =>
      expectRejected(store, setStyleCommand, { changes: [{ id: 'shape-box', style }] }).map(
        (error) => error.code,
      );
    expect(codesOf({})).toEqual(['invalid-input']);
    expect(codesOf({ sides: 2 })).toEqual(['invalid-input']);
    expect(codesOf({ textStyle: { weight: 450 } })).toEqual(['invalid-input']);
  });

  it('converges when two clients restyle different text fields of one sticky', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: 'sticky-idea', style: { textStyle: { weight: 700 } } }],
    });
    applyCommand(
      bob,
      setStyleCommand,
      {
        changes: [
          { id: 'sticky-idea', style: { textStyle: { italic: true }, color: [0, 1, 0, 1] } },
        ],
      },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('sticky-idea'))).toMatchObject({
      color: [0, 1, 0, 1],
      runs: [{ length: 16, style: { ...BODY, weight: 700, italic: true } }],
    });
  });
});
