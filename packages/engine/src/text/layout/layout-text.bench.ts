import { bench, describe } from 'vitest';

import type { ObjectId, StyleRun, TextStyle } from '@canvas/schema';
import { createMetricsMeasurer } from '@canvas/text';
import { layoutText } from '@canvas/text';

import { WorkerPool } from '../../workers/worker-pool.js';
import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';
import { fontsKeyOf, TextLayoutCache } from '../scene/text-layout-cache.js';
import type { TextBoxGeometry } from '../scene/text-placement.js';

import { layoutJob } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';
import { unpackTextLayout } from './packed-layout.js';

// Gated by `pnpm bench:ci` (its micro-benchmark suite).
// TODO: measure a burst of 500 layouts spread across frames through the worker pool,
// which needs the engine host to lay out and draw text before the frame-time suite can drive it.

/** A dirty board's worth of text: 1k paragraphs of about 330 characters each. */
const PARAGRAPH_COUNT = 1000;
const SENTENCE =
  'The quick brown fox jumps over the lazy dog while AVATAR Typography keeps its kerning. ';

const base: TextStyle = {
  fontFamily: BUNDLED_FAMILY,
  fontSize: 16,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

function paragraph(index: number): { text: string; runs: StyleRun[] } {
  const text = `${String(index)}. ${SENTENCE.repeat(4)}`;
  const bold = 24;
  const runs: StyleRun[] = [
    { length: 10, style: base },
    { length: bold, style: { ...base, weight: 700, fontSize: 20, color: [0.8, 0.1, 0.1, 1] } },
    { length: text.length - 10 - bold, style: base },
  ];
  return { text, runs };
}

const library = new FontLibrary();
for (const { face, bytes } of loadBundledFaces()) library.addFace(face, bytes);
const paragraphs = [...Array(PARAGRAPH_COUNT).keys()].map((index) => paragraph(index));
const requests = paragraphs.map(({ text, runs }, index) =>
  createLayoutJobRequest(
    { objectId: `text-${String(index)}`, text, runs, maxWidth: 360, align: 'left' },
    library,
  ),
);
const measurer = createMetricsMeasurer(
  library.faces.flatMap((face) => library.resolve(face)?.metrics ?? []),
);

// The scene text pass's layout cache with every paragraph's layout landed: the hit
// path a frame pays for each text object it prepares without a content change (a move, a
// restyle of another object's run).
const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { layout: layoutJob } });
const cache = new TextLayoutCache(
  { fonts: library, jobs: pool },
  () => undefined,
  () => undefined,
);
const fontsKey = fontsKeyOf(library);
const boxes: TextBoxGeometry[] = paragraphs.map(({ text, runs }) => ({
  text,
  runs,
  origin: { x: 0, y: 0 },
  wrapWidth: 360,
  align: 'left',
  direction: 'auto',
  verticalAlign: 'top',
  boxHeight: 100,
}));
const ids = boxes.map((box, index) => `text-${String(index)}` as ObjectId);
boxes.forEach((box, index) => cache.layoutOf(ids[index] ?? ('' as ObjectId), box, fontsKey));
pool.drainMainThread(Infinity, () => 0);
await new Promise((resolve) => setTimeout(resolve, 0));

describe('text layout, 1k paragraphs', () => {
  bench('TextLayoutCache.layoutOf, every layout cached (the hit path)', () => {
    boxes.forEach((box, index) => cache.layoutOf(ids[index] ?? ('' as ObjectId), box, fontsKey));
  });

  bench('layoutText, wrapped at 360 world units, left aligned', () => {
    for (const { text, runs } of paragraphs) layoutText(text, runs, 360, measurer, 'left');
  });

  bench('layoutText, centred', () => {
    for (const { text, runs } of paragraphs) layoutText(text, runs, 360, measurer, 'center');
  });

  bench('createLayoutJobRequest (face resolution and metrics subsets)', () => {
    paragraphs.forEach(({ text, runs }, index) => {
      createLayoutJobRequest(
        { objectId: `text-${String(index)}`, text, runs, maxWidth: 360, align: 'left' },
        library,
      );
    });
  });

  bench('layout job end to end on one thread (measurer, layout, pack, unpack)', async () => {
    for (const request of requests) {
      const { response } = await layoutJob(request);
      unpackTextLayout(response.layout);
    }
  });
});
