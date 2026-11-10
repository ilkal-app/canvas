import { readFileSync } from 'node:fs';

import { expect, it, vi } from 'vitest';

import { extractFace } from '@canvas/text';

import { LocalFontSource, type LocalFace } from './local-font-source.js';

const UNAVAILABLE = 'Unavailable: this family needs static TrueType or CFF outlines.';
const MAX_BYTES = 128 * 1024 * 1024;
const collection = readFileSync(
  new URL('../../../text/src/__fixtures__/format-corpus/corpus-sans.ttc', import.meta.url),
);
const regular = readFileSync(
  new URL('../../../text/src/__fixtures__/format-corpus/corpus-sans-regular.ttf', import.meta.url),
);

function fakeBlob(
  bytes: Buffer,
  size = bytes.byteLength,
): {
  readonly blob: Blob;
  readonly arrayBuffer: ReturnType<typeof vi.fn<() => Promise<ArrayBuffer>>>;
} {
  const arrayBuffer = vi
    .fn<() => Promise<ArrayBuffer>>()
    .mockImplementation(() => Promise.resolve(Uint8Array.from(bytes).buffer));
  return { blob: { size, arrayBuffer } as unknown as Blob, arrayBuffer };
}

function face(family: string, style: string, blob: Blob, postscriptName?: string): LocalFace {
  return {
    family,
    style,
    ...(postscriptName === undefined ? {} : { postscriptName }),
    blob: () => Promise.resolve(blob),
  };
}

it('reads one collection file once and extracts every face in the family', async () => {
  const shared = fakeBlob(collection);
  const source = new LocalFontSource(() =>
    Promise.resolve([
      face('Corpus Sans', 'Regular', shared.blob, 'CorpusSans-Regular'),
      face('Corpus Sans', 'Bold', shared.blob, 'CorpusSans-Bold'),
    ]),
  );
  await source.list();
  const files = await source.load('Corpus Sans');
  expect(shared.arrayBuffer).toHaveBeenCalledTimes(1);
  expect(files.map(({ face: key }) => key.weight)).toEqual([400, 700]);
  expect(new Uint8Array(files[0]?.bytes ?? new ArrayBuffer(0))).toEqual(extractFace(collection, 0));
  expect(new Uint8Array(files[1]?.bytes ?? new ArrayBuffer(0))).toEqual(extractFace(collection, 1));
});

it('never reads a file larger than 128 MiB and omits that face beside a valid one', async () => {
  const tooLarge = fakeBlob(regular, MAX_BYTES + 1);
  const valid = fakeBlob(regular);
  const source = new LocalFontSource(() =>
    Promise.resolve([face('Mixed', 'Regular', tooLarge.blob), face('Mixed', 'Bold', valid.blob)]),
  );
  await source.list();
  const files = await source.load('Mixed');
  expect(tooLarge.arrayBuffer).not.toHaveBeenCalled();
  expect(valid.arrayBuffer).toHaveBeenCalledTimes(1);
  expect(files.map(({ face: key }) => key.weight)).toEqual([700]);
});

it('reports Unavailable without reading when every face exceeds 128 MiB', async () => {
  const tooLarge = fakeBlob(regular, MAX_BYTES + 1);
  const source = new LocalFontSource(() =>
    Promise.resolve([face('Oversized', 'Regular', tooLarge.blob)]),
  );
  await source.list();
  const outcome: unknown = await source.load('Oversized').then(
    () => 'resolved',
    (error: unknown) => error,
  );
  expect(outcome).toMatchObject({ message: UNAVAILABLE });
  expect(tooLarge.arrayBuffer).not.toHaveBeenCalled();
});

it('loads two families concurrently with their own collection faces and one read per file', async () => {
  const first = fakeBlob(collection);
  const second = fakeBlob(collection);
  const source = new LocalFontSource(() =>
    Promise.resolve([
      face('Family A', 'Regular', first.blob, 'CorpusSans-Regular'),
      face('Family A', 'Bold', first.blob, 'CorpusSans-Bold'),
      face('Family B', 'Regular', second.blob, 'CorpusSans-Regular'),
      face('Family B', 'Bold', second.blob, 'CorpusSans-Bold'),
    ]),
  );
  await source.list();
  const [a, b] = await Promise.all([source.load('Family A'), source.load('Family B')]);
  expect(first.arrayBuffer).toHaveBeenCalledTimes(1);
  expect(second.arrayBuffer).toHaveBeenCalledTimes(1);
  expect(a.map(({ face: key }) => [key.family, key.weight])).toEqual([
    ['Family A', 400],
    ['Family A', 700],
  ]);
  expect(b.map(({ face: key }) => [key.family, key.weight])).toEqual([
    ['Family B', 400],
    ['Family B', 700],
  ]);
});
