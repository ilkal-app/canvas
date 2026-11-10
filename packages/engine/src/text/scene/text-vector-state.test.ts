import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import type { WorkerPool } from '../../workers/worker-pool.js';
import { FontLibrary } from '../font/font-library.js';
import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';
import type { GlyphGeometryJobRequest } from '../vector/glyph-geometry-job-payload.js';

import { addBundledFaces, STYLE } from './__fixtures__/text-objects.js';
import type { OrderedGlyphQuads } from './ordered-glyph-quads.js';
import type { TextObjectEntry } from './text-object-entry.js';
import { TextVectorState } from './text-vector-state.js';

const ID = 'text' as ObjectId;

/**
 * A pool whose `glyphGeometry` jobs the test lands by hand.
 *
 * @returns The pool and its jobs.
 */
function recordingPool() {
  const jobs: { request: GlyphGeometryJobRequest; land: () => void }[] = [];
  const pool = {
    submit(kind: string, request: GlyphGeometryJobRequest, options: SubmitOptions) {
      expect(kind).toBe('glyphGeometry');
      expect(options.priority).toBe('visible');
      let land = (): void => undefined;
      const response = new Promise((resolve) => {
        land = () => {
          resolve({
            faceId: request.faceId,
            glyphs: request.keys.map((key) => ({
              key,
              vertices: new Float32Array(12),
              vertexCount: 3,
              bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
            })),
          });
        };
      });
      jobs.push({ request, land });
      return { id: jobs.length, response } as JobTicket<'glyphGeometry'>;
    },
  } as unknown as Pick<WorkerPool, 'submit'>;
  return { pool, jobs };
}

function setUp() {
  const fonts = new FontLibrary();
  addBundledFaces(fonts);
  const { pool, jobs } = recordingPool();
  const landed = new Set<ObjectId>();
  const frames = { count: 0 };
  const state = new TextVectorState({ fonts, jobs: pool }, landed, () => {
    frames.count += 1;
  });
  const layout = layoutText('A', [{ length: 1, style: STYLE }], null, new FakeGlyphMeasurer());
  const run = layout.runs[0];
  if (run === undefined) throw new Error('no run');
  return { fonts, jobs, landed, frames, state, layout, run };
}

function quadsOf(vectorRuns: readonly number[]): OrderedGlyphQuads {
  return { quads: [], tiers: ['vector'], isComplete: vectorRuns.length > 0, vectorRuns };
}

describe('TextVectorState', () => {
  it('rewrites the texts waiting for geometry when it lands, and only them', async () => {
    const { jobs, landed, frames, state, layout, run } = setUp();
    expect(state.isRunReady(layout, 0, run)).toBe(false);
    state.note(ID, {} as TextObjectEntry, layout, quadsOf([]));
    await flushMicrotasks();
    expect(jobs).toHaveLength(1);
    expect(state.isIdle).toBe(false);
    const revision = state.revision;
    jobs[0]?.land();
    await flushMicrotasks();
    expect(landed).toEqual(new Set([ID]));
    state.note(ID, {} as TextObjectEntry, layout, quadsOf([0]));
    expect(state.isIdle).toBe(true);
    expect(frames.count).toBeGreaterThan(0);
    expect(state.revision).toBe(revision + 1);
    expect(state.isRunReady(layout, 0, run)).toBe(true);
  });

  it('tracks the texts drawing runs from their outlines, and forgets them', () => {
    const { state, layout } = setUp();
    const entry = {} as TextObjectEntry;
    state.note(ID, entry, layout, quadsOf([0]));
    expect(state.drawn.get(ID)).toEqual({ entry, layout, runs: [0] });
    const version = state.version;
    state.forget(ID);
    expect(state.drawn.size).toBe(0);
    expect(state.version).toBe(version + 1);
    state.forget(ID);
    expect(state.version).toBe(version + 1);
  });

  it('has a text built again when its drawn runs lost their geometry', () => {
    const { landed, frames, state } = setUp();
    state.invalidate(ID);
    expect(landed.has(ID)).toBe(true);
    expect(frames.count).toBe(1);
  });

  it('drops all geometry when a face is added, and ignores the old source landing later', async () => {
    const { fonts, jobs, landed, state, layout, run } = setUp();
    state.isRunReady(layout, 0, run);
    state.note(ID, {} as TextObjectEntry, layout, quadsOf([]));
    await flushMicrotasks();
    expect(state.beginFrame()).toBe(false);
    addBundledFaces(fonts);
    const revision = state.revision;
    expect(state.beginFrame()).toBe(true);
    expect(state.revision).toBe(revision + 1);
    jobs[0]?.land();
    await flushMicrotasks();
    expect(landed.size).toBe(0);
  });
});
