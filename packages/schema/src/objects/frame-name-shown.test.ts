import { describe, expect, it } from 'vitest';

import type { ObjectId } from '../ids/object-id.js';

import { isFrameNameShown, type FrameNameAncestor } from './frame-name-shown.js';
import { frameObjectSchema } from './frame-object.js';

type Node = FrameNameAncestor & { readonly id: string };

/**
 * A lookup over some ancestors.
 *
 * @param nodes - The ancestors.
 * @returns The lookup.
 */
function lookupOf(...nodes: readonly Node[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (id: ObjectId): FrameNameAncestor | undefined => byId.get(id);
}

const id = (text: string) => text as ObjectId;
const frameIn = (parentId: string | null, isShown?: boolean) => ({
  parentId: parentId === null ? null : id(parentId),
  ...(isShown === undefined ? {} : { showName: isShown }),
});

describe('isFrameNameShown', () => {
  const lookup = lookupOf(
    { id: 'outer', type: 'frame', parentId: null },
    { id: 'group-in-frame', type: 'group', parentId: id('outer') },
    { id: 'deep-group', type: 'group', parentId: id('group-in-frame') },
    { id: 'root-group', type: 'group', parentId: null },
    { id: 'nested-group', type: 'group', parentId: id('root-group') },
    { id: 'main', type: 'component', parentId: null },
    { id: 'group-in-main', type: 'group', parentId: id('main') },
    { id: 'copy', type: 'instance', parentId: null },
    { id: 'loop-a', type: 'group', parentId: id('loop-b') },
    { id: 'loop-b', type: 'group', parentId: id('loop-a') },
  );

  it('shows a root frame’s name by default', () => {
    expect(isFrameNameShown(frameIn(null), lookup)).toBe(true);
  });

  it('hides the name of a frame in a frame, directly or through groups', () => {
    expect(isFrameNameShown(frameIn('outer'), lookup)).toBe(false);
    expect(isFrameNameShown(frameIn('group-in-frame'), lookup)).toBe(false);
    expect(isFrameNameShown(frameIn('deep-group'), lookup)).toBe(false);
  });

  it('shows the name of a frame with only groups above it', () => {
    expect(isFrameNameShown(frameIn('root-group'), lookup)).toBe(true);
    expect(isFrameNameShown(frameIn('nested-group'), lookup)).toBe(true);
  });

  it('hides the name of a frame in a component, directly or through a group', () => {
    expect(isFrameNameShown(frameIn('main'), lookup)).toBe(false);
    expect(isFrameNameShown(frameIn('group-in-main'), lookup)).toBe(false);
  });

  it('hides the name of a frame in an instance’s expanded copy, as in its main', () => {
    expect(isFrameNameShown(frameIn('copy'), lookup)).toBe(false);
    expect(isFrameNameShown(frameIn('copy', true), lookup)).toBe(true);
  });

  it('follows an explicit showName in every case', () => {
    for (const parentId of [null, 'outer', 'deep-group', 'root-group', 'main', 'group-in-main']) {
      expect(isFrameNameShown(frameIn(parentId, true), lookup)).toBe(true);
      expect(isFrameNameShown(frameIn(parentId, false), lookup)).toBe(false);
    }
  });

  it('counts a missing ancestor or a parent cycle as the root', () => {
    expect(isFrameNameShown(frameIn('gone'), lookup)).toBe(true);
    expect(isFrameNameShown(frameIn('loop-a'), lookup)).toBe(true);
  });

  it('never mutates the frame it reads', () => {
    const frame = Object.freeze(frameIn('outer', true));
    isFrameNameShown(frame, lookup);
    expect(frame).toEqual({ parentId: 'outer', showName: true });
  });
});

describe('frameObjectSchema showName', () => {
  const frame = {
    id: 'f',
    type: 'frame',
    parentId: null,
    pageId: 'page-1',
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada',
    createdAt: 1,
    updatedAt: 1,
    width: 10,
    height: 10,
    name: 'Plan',
    clip: false,
    background: null,
  };

  it('accepts a frame without showName, keeping it absent', () => {
    const parsed = frameObjectSchema.parse(frame);
    expect('showName' in parsed).toBe(false);
  });

  it('accepts a boolean showName and refuses anything else', () => {
    expect(frameObjectSchema.parse({ ...frame, showName: false }).showName).toBe(false);
    expect(frameObjectSchema.safeParse({ ...frame, showName: 'yes' }).success).toBe(false);
    expect(frameObjectSchema.safeParse({ ...frame, showName: null }).success).toBe(false);
  });
});
