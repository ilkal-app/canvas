import { describe, expect, it } from 'vitest';

import type { BoardObject, FrameObject, ObjectId } from '@canvas/schema';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ADA, fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { FIT_FRAME_PADDING, fitFrameToContentCommand } from './fit-frame-to-content.js';

const id = (value: string): ObjectId => value as ObjectId;

function geometry(object: BoardObject): unknown {
  return 'width' in object
    ? {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
      }
    : { x: object.x, y: object.y, rotation: object.rotation };
}

describe('fitFrameToContent', () => {
  it('fits direct children in frame coordinates, including a rotated child, and keeps board placement through one undo', () => {
    const store = createNestedFramesStore();
    const history = createHistory(store, ADA_ID);
    const frameBefore = mustGet(store, 'frame-outer');
    const direct = ['frame-inner', 'rect-outer', 'group-g'];
    const before = new Map(
      [frameBefore, ...direct.map((key) => mustGet(store, key)), mustGet(store, 'rect-inner')].map(
        (object) => [object.id, geometry(object)],
      ),
    );
    const snapshot = store.read();
    const { changes } = applyCommand(store, fitFrameToContentCommand, {
      id: id('frame-outer'),
      padding: 10,
    });
    const frame = mustGet(store, 'frame-outer') as FrameObject;
    // frame-inner's rotated 200 × 150 box extends left of its stored x=30.
    const corners = [
      ...[
        [0, 0],
        [200, 0],
        [200, 150],
        [0, 150],
      ].map(([x, y]) => ({
        x: 30 + (x ?? 0) * Math.cos(-0.25) - (y ?? 0) * Math.sin(-0.25),
        y: 20 + (x ?? 0) * Math.sin(-0.25) + (y ?? 0) * Math.cos(-0.25),
      })),
      ...[
        [0, 0],
        [40, 0],
        [40, 30],
        [0, 30],
      ].map(([x, y]) => ({
        x: 250 + (x ?? 0) * Math.cos(0.1) - (y ?? 0) * Math.sin(0.1),
        y: 200 + (x ?? 0) * Math.sin(0.1) + (y ?? 0) * Math.cos(0.1),
      })),
      { x: 300, y: 30 },
      { x: 340, y: 60 },
    ];
    const left = Math.min(...corners.map((point) => point.x)) - 10;
    const top = Math.min(...corners.map((point) => point.y)) - 10;
    expect(frame.width).toBeCloseTo(Math.max(...corners.map((point) => point.x)) - left + 10);
    expect(frame.height).toBeCloseTo(Math.max(...corners.map((point) => point.y)) - top + 10);
    expect(frame.x).toBeCloseTo(frameBefore.x + left * Math.cos(0.4) - top * Math.sin(0.4));
    expect(frame.y).toBeCloseTo(frameBefore.y + left * Math.sin(0.4) + top * Math.cos(0.4));
    for (const key of direct) {
      const old = snapshot.objects.get(id(key));
      const next = mustGet(store, key);
      expect(next.x).toBeCloseTo((old?.x ?? NaN) - left);
      expect(next.y).toBeCloseTo((old?.y ?? NaN) - top);
    }
    expect(geometry(mustGet(store, 'rect-inner'))).toEqual(before.get(id('rect-inner')));
    expectDiff(snapshot, store.read(), changes, { updated: ['frame-outer', ...direct] });
    expect(history.undo()).toBe(true);
    for (const [key, value] of before) expect(geometry(mustGet(store, key))).toEqual(value);
    expect(history.undo()).toBe(false);
  });

  it('uses the exported default padding, and accepts an already fitted frame without a write', () => {
    const store = createNestedFramesStore();
    expect(FIT_FRAME_PADDING).toBe(40);
    applyCommand(store, fitFrameToContentCommand, { id: id('frame-side') });
    expect(mustGet(store, 'frame-side')).toMatchObject({ x: 770, y: -30, width: 120, height: 110 });
    const before = store.read();
    const { changes } = applyCommand(store, fitFrameToContentCommand, { id: id('frame-side') });
    expectDiff(before, store.read(), changes, {});
  });

  it('keeps a locked child in place on the board', () => {
    const store = createNestedFramesStore();
    const child = mustGet(store, 'rect-side');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('rect-side'), { locked: true });
    });
    applyCommand(store, fitFrameToContentCommand, { id: id('frame-side'), padding: 0 });
    expect(mustGet(store, 'rect-side')).toMatchObject({ locked: true, x: 0, y: 0 });
    expect(mustGet(store, 'frame-side')).toMatchObject({ x: 810, y: 10, width: 40, height: 30 });
    expect(child.parentId).toBe(id('frame-side'));
  });

  it('counts hidden children but ignores connectors and comments', () => {
    const store = createNestedFramesStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('rect-side'), { isHidden: true });
      transaction.setObject({
        ...fixtureObject('connector-flow', 'connector'),
        id: id('side-connector'),
        parentId: id('frame-side'),
        x: 1000,
        y: 1000,
      });
      transaction.setObject({
        ...fixtureObject('comment-free', 'comment'),
        id: id('side-comment'),
        parentId: id('frame-side'),
        x: 2000,
        y: 2000,
      });
    });
    applyCommand(store, fitFrameToContentCommand, { id: id('frame-side'), padding: 0 });
    expect(mustGet(store, 'frame-side')).toMatchObject({ x: 810, y: 10, width: 40, height: 30 });
    expect(mustGet(store, 'rect-side')).toMatchObject({ isHidden: true, x: 0, y: 0 });
    store.transact(ADA, (transaction) => transaction.deleteObject(id('rect-side')));
    expect(
      expectRejected(store, fitFrameToContentCommand, { id: id('frame-side') }).map(
        (error) => error.code,
      ),
    ).toContain('invalid-input');
  });

  it('refuses malformed padding, missing and non-frame objects, locked and auto-layout frames, and empty frames', () => {
    const store = createNestedFramesStore();
    const codes = (input: unknown) =>
      expectRejected(store, fitFrameToContentCommand, input).map((error) => error.code);
    for (const padding of [-1, 1001, Infinity, NaN])
      expect(codes({ id: 'frame-side', padding })).toContain('invalid-input');
    expect(codes({ id: 'frame-side', extra: true })).toContain('invalid-input');
    expect(codes({ id: 'missing' })).toContain('missing-object');
    expect(codes({ id: 'rect-free' })).toContain('invalid-input');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('frame-side'), { locked: true });
    });
    expect(codes({ id: 'frame-side' })).toContain('locked');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('frame-side'), {
        locked: false,
        autoLayout: {
          direction: 'row',
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          width: 'fixed',
          height: 'fixed',
          align: 'start',
          justify: 'start',
        },
      });
    });
    expect(codes({ id: 'frame-side' })).toContain('invalid-input');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('frame-side'), { autoLayout: undefined });
    });
    store.transact(ADA, (transaction) => transaction.deleteObject(id('rect-side')));
    expect(codes({ id: 'frame-side' })).toContain('invalid-input');
  });
});
