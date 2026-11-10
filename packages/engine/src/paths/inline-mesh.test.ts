import { describe, expect, it } from 'vitest';

import { DRAFT_PREVIEW_Z, type FreehandObject } from '@canvas/schema';

import type { DrawnPath } from './drawn-path.js';
import {
  FRESH_STROKE_SEGMENTS,
  INLINE_MESH_SEGMENTS_PER_FRAME,
  isLiveStroke,
  isMeshedInline,
} from './inline-mesh.js';

describe('isMeshedInline', () => {
  it('meshes changed connectors and strokes in the frame, and strokes just begun', () => {
    expect(isMeshedInline('connector', true, 500, 0)).toBe(true);
    expect(isMeshedInline('freehand', true, INLINE_MESH_SEGMENTS_PER_FRAME, 0)).toBe(true);
    expect(isMeshedInline('freehand', false, FRESH_STROKE_SEGMENTS, 0)).toBe(true);
  });

  it('leaves first meshes of other paths, and of long strokes, to the builder', () => {
    expect(isMeshedInline('connector', false, 1, 0)).toBe(false);
    expect(isMeshedInline('freehand', false, FRESH_STROKE_SEGMENTS + 1, 0)).toBe(false);
    expect(isMeshedInline('path', true, 4, 0)).toBe(false);
    expect(isMeshedInline('line', true, 1, 0)).toBe(false);
  });

  it('meshes nothing in the frame past its inline allowance', () => {
    expect(isMeshedInline('freehand', true, INLINE_MESH_SEGMENTS_PER_FRAME + 1, 0)).toBe(false);
    expect(isMeshedInline('freehand', true, 10, INLINE_MESH_SEGMENTS_PER_FRAME - 9)).toBe(false);
    expect(isMeshedInline('freehand', true, 10, INLINE_MESH_SEGMENTS_PER_FRAME - 10)).toBe(true);
  });
});

describe('isLiveStroke', () => {
  const draft = { type: 'freehand', z: DRAFT_PREVIEW_Z } as FreehandObject;

  it('is the draw tool’s preview: a freehand path on the draft key, at most one piece', () => {
    expect(isLiveStroke(draft, INLINE_MESH_SEGMENTS_PER_FRAME)).toBe(true);
    expect(isLiveStroke(draft, INLINE_MESH_SEGMENTS_PER_FRAME + 1)).toBe(false);
    expect(isLiveStroke({ ...draft, z: 'a0' }, 10)).toBe(false);
    expect(isLiveStroke({ type: 'line', z: DRAFT_PREVIEW_Z } as DrawnPath, 1)).toBe(false);
  });
});
