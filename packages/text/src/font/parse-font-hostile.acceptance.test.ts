import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FontFormatError } from './font-format-error.js';
import { parseFont, type ParsedFont } from './parse-font.js';

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const NAMES = [
  'corpus-sans-regular.ttf',
  'corpus-serif-regular.ttf',
  'corpus-sans-regular.cff.otf',
] as const;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function table(bytes: Uint8Array, tag: string): { record: number; offset: number; length: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const record = 12 + index * 16;
    const name = String.fromCharCode(...bytes.slice(record, record + 4));
    if (name === tag)
      return { record, offset: view.getUint32(record + 8), length: view.getUint32(record + 12) };
  }
  throw new Error(`Missing ${tag} fixture table`);
}

function expectFontError(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error, 'malformed font must report FontFormatError').toBeInstanceOf(FontFormatError);
  }
}

function exercise(bytes: Uint8Array): void {
  let font: ParsedFont;
  try {
    font = parseFont(bytes);
  } catch (error) {
    expect(error, 'malformed font must report FontFormatError').toBeInstanceOf(FontFormatError);
    return;
  }
  for (let id = 0; id < 50; id += 1) {
    expectFontError(() => font.outlineOf(id));
    expectFontError(() => font.glyphIdOf(id));
    expectFontError(() => font.advanceOf(id));
    expectFontError(() => font.kerningOf(id, id + 1));
  }
  expectFontError(() => font.characterMap());
  expectFontError(() => font.kerningPairs());
}

function mutate(bytes: Uint8Array, next: () => number, iteration: number): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  switch (iteration % 5) {
    case 0:
      for (let count = 0; count < 1 + (next() % 8); count += 1)
        copy[next() % copy.length] = next() % 256;
      return copy;
    case 1:
      return copy.slice(0, next() % copy.length);
    case 2: {
      const record = 12 + (next() % view.getUint16(4)) * 16;
      view.setUint32(record + 8, 0xffffffff);
      return copy;
    }
    case 3: {
      const record = 12 + (next() % view.getUint16(4)) * 16;
      view.setUint32(record + 12, 0xffffffff);
      return copy;
    }
    default:
      view.setUint16(4, 0xffff);
      return copy;
  }
}

describe.each(NAMES)('hostile parser input: %s', (name) => {
  const bytes = new Uint8Array(readFileSync(new URL(name, CORPUS)));

  it('confines 400 seeded mutations across parsing and every ParsedFont method', () => {
    const next = seeded(511);
    for (let iteration = 0; iteration < 400; iteration += 1)
      exercise(mutate(bytes, next, iteration));
  });
});

it('reports a glyf/loca offset beyond the glyf table as FontFormatError', () => {
  const bytes = new Uint8Array(readFileSync(new URL(NAMES[0], CORPUS)));
  const loca = table(bytes, 'loca');
  const glyf = table(bytes, 'glyf');
  const head = table(bytes, 'head');
  const view = new DataView(bytes.buffer);
  const isLong = view.getInt16(head.offset + 50) === 1;
  const beyond = glyf.length + 64;
  if (isLong) {
    view.setUint32(loca.offset, beyond);
    view.setUint32(loca.offset + 4, beyond + 16);
  } else {
    view.setUint16(loca.offset, Math.ceil(beyond / 2));
    view.setUint16(loca.offset + 2, Math.ceil(beyond / 2) + 8);
  }
  expect(() => parseFont(bytes).outlineOf(0)).toThrow(FontFormatError);
});

it('reports hmtx shorter than numberOfHMetrics as FontFormatError', () => {
  const bytes = new Uint8Array(readFileSync(new URL(NAMES[0], CORPUS)));
  const hmtx = table(bytes, 'hmtx');
  new DataView(bytes.buffer).setUint32(hmtx.record + 12, 2);
  expect(() => parseFont(bytes)).toThrow(FontFormatError);
});

it('reports a cmap subtable offset beyond cmap as FontFormatError', () => {
  const bytes = new Uint8Array(readFileSync(new URL(NAMES[0], CORPUS)));
  const cmap = table(bytes, 'cmap');
  const view = new DataView(bytes.buffer);
  const count = view.getUint16(cmap.offset + 2);
  for (let index = 0; index < count; index += 1)
    view.setUint32(cmap.offset + 4 + index * 8 + 4, cmap.length + 32);
  expect(() => parseFont(bytes)).toThrow(FontFormatError);
});
