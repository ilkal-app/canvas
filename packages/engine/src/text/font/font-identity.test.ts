import { afterEach, expect, it, vi } from 'vitest';

import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';

import { FontLibrary } from './font-library.js';

const FACES = loadBundledFaces();
const EXPECTED = FACES.map(({ face }) => face);
function library(): FontLibrary {
  const fonts = new FontLibrary();
  for (const { face, bytes } of FACES) fonts.addFace(face, bytes);
  return fonts;
}
afterEach(() => vi.restoreAllMocks());

it('provides stable content identity only for a complete successful ordered catalogue', async () => {
  const fonts = library();
  expect(fonts.contentIdentity).toBeUndefined();
  const key = await fonts.prepareContentIdentity(EXPECTED);
  expect(key).toMatch(/^font-set:v1:/);
  expect(fonts.contentIdentity).toBe(key);
  expect(await library().prepareContentIdentity(EXPECTED)).toBe(key);
  expect(await fonts.prepareContentIdentity([...EXPECTED].reverse())).toBeUndefined();
  expect(fonts.contentIdentity).toBeUndefined();
  expect(await new FontLibrary().prepareContentIdentity([])).toBeUndefined();
});

it('refuses missing or failed faces even when the caller has finished its load loop', async () => {
  const fonts = new FontLibrary();
  const first = FACES[0];
  if (first === undefined) throw new Error('Missing fixture');
  fonts.addFace(first.face, first.bytes);
  expect(() => fonts.addFace(EXPECTED[1] ?? first.face, new ArrayBuffer(8))).toThrow();
  expect(await fonts.prepareContentIdentity(EXPECTED)).toBeUndefined();
});

it('invalidates immediately on replacement and distinguishes new bytes under the same face id', async () => {
  const fonts = library();
  const first = FACES[0];
  const second = FACES[1];
  if (first === undefined || second === undefined) throw new Error('Missing fixture');
  const old = await fonts.prepareContentIdentity(EXPECTED);
  fonts.addFace(first.face, second.bytes);
  expect(fonts.contentIdentity).toBeUndefined();
  const changed = await fonts.prepareContentIdentity(EXPECTED);
  expect(changed).toMatch(/^font-set:v1:/);
  expect(changed).not.toBe(old);
});

it('does not publish a stale asynchronous digest or certify after hashing failure', async () => {
  const fonts = library();
  let finish: ((value: ArrayBuffer) => void) | undefined;
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const single = new FontLibrary();
  const first = FACES[0];
  if (first === undefined) throw new Error('Missing fixture');
  single.addFace(first.face, first.bytes);
  const pending = single.prepareContentIdentity([first.face]);
  single.addFace(first.face, first.bytes);
  finish?.(new ArrayBuffer(32));
  await expect(pending).resolves.toBeUndefined();
  expect(single.contentIdentity).toBeUndefined();
  vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('digest unavailable'));
  await expect(fonts.prepareContentIdentity(EXPECTED)).resolves.toBeUndefined();
});

it('does not let an older catalogue request republish identity after a later refusal', async () => {
  const fonts = new FontLibrary();
  const first = FACES[0];
  if (first === undefined) throw new Error('Missing fixture');
  fonts.addFace(first.face, first.bytes);
  let finish: ((value: ArrayBuffer) => void) | undefined;
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = fonts.prepareContentIdentity([first.face]);
  await expect(fonts.prepareContentIdentity([])).resolves.toBeUndefined();
  finish?.(new ArrayBuffer(32));
  await expect(old).resolves.toBeUndefined();
  expect(fonts.contentIdentity).toBeUndefined();
});

it('keeps parsed content identity independent of exposed byte buffers and face metadata', async () => {
  const fonts = library();
  const first = FACES[0];
  if (first === undefined) throw new Error('Missing fixture');
  const loaded = fonts.resolve(first.face);
  if (loaded === undefined) throw new Error('Missing loaded face');
  const expected = await library().prepareContentIdentity(EXPECTED);
  const advance = loaded.font.advanceOf(loaded.font.glyphIdOf(65));
  const exposed = loaded.bytes;
  new Uint8Array(exposed).fill(0);
  expect(new Uint8Array(loaded.bytes)[1]).toBe(1);
  structuredClone(exposed, { transfer: [exposed] });
  expect(loaded.bytes.byteLength).toBe(first.bytes.byteLength);
  expect(() => Object.assign(loaded.face, { family: 'mutated' })).toThrow(TypeError);
  expect(loaded.font.advanceOf(loaded.font.glyphIdOf(65))).toBe(advance);
  expect(await fonts.prepareContentIdentity(EXPECTED)).toBe(expected);
});
