import { expect, it } from 'vitest';

import { createLargeBoardObjects, DOCUMENT_LAYOUT_VERSION } from '@canvas/document';
import { type PreviewCertificate, visibleWorldBounds } from '@canvas/engine';
import { createBoard, exportBoard } from '@canvas/schema';

import { readCachedProjection } from './cached-projection.js';

const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const expected = { boardId: 'board', fontSetKey: 'font-sha', camera };
const objects = createLargeBoardObjects(10, 126).filter((object) => object.type !== 'image');
const first = objects[0];
if (first === undefined) throw new Error('Missing fixture object.');
const certificate: PreviewCertificate = {
  scene: { session: 'old-mount', sequence: 0 },
  camera,
  coverage: visibleWorldBounds(camera),
  fontSetKey: 'font-sha',
  candidates: objects.map((object) => object.id),
  assets: [],
  imagePlanKey: '[]',
  lodPlanKey: '[]',
  frameIndex: 0,
  resourceGeneration: 0,
};
function envelope(): Record<string, unknown> {
  return {
    format: 'canvas.cached-projection',
    version: 1,
    boardId: 'board',
    layoutVersion: DOCUMENT_LAYOUT_VERSION,
    certificate,
    projection: exportBoard(createBoard(objects)),
  };
}
function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

it('reads an owned current-layout projection with the exact certified viewport', () => {
  const encoded = bytes(envelope());
  const before = encoded.slice();
  const result = readCachedProjection(encoded, expected);
  expect(result?.board.objects.size).toBe(objects.length);
  expect(result?.certificate).toEqual(certificate);
  expect(result?.board.objects.get(first.id)).not.toBe(first);
  expect(encoded).toEqual(before);
});

it.each([
  { format: 'other' },
  { version: 2 },
  { boardId: 'another-board' },
  { layoutVersion: DOCUMENT_LAYOUT_VERSION - 1 },
  { layoutVersion: DOCUMENT_LAYOUT_VERSION + 1 },
  { certificate: { ...certificate, fontSetKey: 'changed-font' } },
  { certificate: { ...certificate, camera: { ...camera, dpr: 2 } } },
  { certificate: { ...certificate, coverage: { ...certificate.coverage, maxX: 1 } } },
  { certificate: { ...certificate, candidates: ['missing-object'] } },
  { certificate: { ...certificate, candidates: [] } },
  { certificate: { ...certificate, candidates: [first.id, first.id] } },
  { projection: { ...exportBoard(createBoard(objects)), schemaVersion: 0 } },
])('falls back for stale or incompatible identity: %j', (change) => {
  expect(readCachedProjection(bytes({ ...envelope(), ...change }), expected)).toBeUndefined();
});

it('refuses corrupt JSON, invalid UTF-8 and invalid object references without modifying bytes', () => {
  for (const encoded of [
    bytes(null),
    bytes([]),
    new Uint8Array([0xff]),
    bytes({
      ...envelope(),
      projection: {
        ...exportBoard(createBoard(objects)),
        objects: [{ ...first, parentId: 'missing' }],
      },
    }),
  ]) {
    const before = encoded.slice();
    expect(readCachedProjection(encoded, expected)).toBeUndefined();
    expect(encoded).toEqual(before);
  }
});

it('requires content evidence for every image object before a new mount may verify it', () => {
  const image = createLargeBoardObjects(100, 126).find((object) => object.type === 'image');
  if (image === undefined) throw new Error('Missing fixture image.');
  const projection = exportBoard(createBoard([{ ...image, parentId: null }]));
  const value = {
    ...envelope(),
    projection,
    certificate: { ...certificate, candidates: [image.id] },
  };
  expect(readCachedProjection(bytes(value), expected)).toBeUndefined();
  const proved = {
    ...value,
    certificate: {
      ...value.certificate,
      assets: [{ assetId: image.assetId, contentVersion: 'verified-content' }],
    },
  };
  expect(readCachedProjection(bytes(proved), expected)?.board.objects.size).toBe(1);
});

it('restores the certified camera only when the current viewport and font match', () => {
  const viewport = { viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
  expect(
    readCachedProjection(bytes(envelope()), {
      boardId: 'board',
      fontSetKey: 'font-sha',
      viewport,
    })?.certificate.camera,
  ).toEqual(camera);
  expect(
    readCachedProjection(bytes(envelope()), {
      boardId: 'board',
      fontSetKey: 'font-sha',
      viewport: { ...viewport, dpr: 2 },
    }),
  ).toBeUndefined();
});
