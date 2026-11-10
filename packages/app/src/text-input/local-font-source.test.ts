import { readFileSync } from 'node:fs';

import { expect, it, vi } from 'vitest';

import { LocalFontSource, weightOfStyleName } from './local-font-source.js';

const bytes = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);
it('loads each weight a local family has, regular and bold from their own files', async () => {
  const alternate = readFileSync(
    new URL('../../../engine/assets/fonts/LiberationSans-Bold.ttf', import.meta.url),
  );
  const source = new LocalFontSource(() =>
    Promise.resolve(
      ['Light', 'Black', 'Regular', 'Bold'].map((style) => ({
        family: 'Local Example',
        style,
        blob: () =>
          Promise.resolve(new Blob([style === 'Light' || style === 'Black' ? alternate : bytes])),
      })),
    ),
  );
  await source.list();
  const faces = await source.load('Local Example');
  expect(faces.map(({ face }) => face.weight).sort()).toEqual([300, 400, 700, 900]);
  for (const { face, bytes: loaded } of faces) {
    expect(Buffer.from(loaded).equals(bytes), String(face.weight)).toBe(
      face.weight === 400 || face.weight === 700,
    );
  }
});

it('reads a weight from a style name, the most specific word first', () => {
  const cases: readonly (readonly [string, number])[] = [
    ['Thin', 100],
    ['ExtraLight', 200],
    ['Light Italic', 300],
    ['Regular', 400],
    ['Book', 400],
    ['Medium', 500],
    ['SemiBold', 600],
    ['Demi Bold Italic', 600],
    ['Bold', 700],
    ['ExtraBold', 800],
    ['Black', 900],
    ['Heavy', 900],
  ];
  for (const [style, weight] of cases) expect(weightOfStyleName(style), style).toBe(weight);
});
it('requests permission explicitly, groups families and keeps bytes local until requested', async () => {
  const blob = vi.fn(() => Promise.resolve(new Blob([bytes])));
  const query = vi.fn(() =>
    Promise.resolve([
      { family: 'Local Example', style: 'Regular', blob },
      { family: 'Local Example', style: 'Bold Italic', blob },
    ]),
  );
  const source = new LocalFontSource(query);
  expect(query).not.toHaveBeenCalled();
  expect(await source.list()).toEqual(['Local Example']);
  expect(blob).not.toHaveBeenCalled();
  const faces = await source.load('Local Example');
  expect(faces.map(({ face }) => face)).toEqual([
    { family: 'Local Example', weight: 400, isItalic: false },
    { family: 'Local Example', weight: 700, isItalic: true },
  ]);
  expect(await source.load('Local Example')).toBe(faces);
  expect(blob).toHaveBeenCalledTimes(2);
});
it('reports unsupported outlines instead of installing them', async () => {
  const source = new LocalFontSource(() =>
    Promise.resolve([
      { family: 'CFF', style: 'Regular', blob: () => Promise.resolve(new Blob(['OTTO'])) },
    ]),
  );
  await source.list();
  await expect(source.load('CFF')).rejects.toThrow('static TrueType');
});

it('refuses variable tables even when the file also has TrueType outlines', async () => {
  const variable = Buffer.from(bytes);
  const count = variable.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const offset = 12 + index * 16;
    if (variable.toString('ascii', offset, offset + 4) === 'name')
      variable.write('fvar', offset, 'ascii');
  }
  const source = new LocalFontSource(() =>
    Promise.resolve([
      { family: 'Variable', style: 'Regular', blob: () => Promise.resolve(new Blob([variable])) },
    ]),
  );
  await source.list();
  await expect(source.load('Variable')).rejects.toThrow('static TrueType');
});

it('loads OpenType-CFF and static CFF2 faces with their bytes unchanged', async () => {
  const corpus = (name: string) =>
    readFileSync(new URL(`../../../text/src/__fixtures__/format-corpus/${name}`, import.meta.url));
  const cff = corpus('corpus-sans-regular.cff.otf');
  const cff2 = corpus('corpus-sans-bold.cff2.otf');
  const source = new LocalFontSource(() =>
    Promise.resolve([
      { family: 'Outlines', style: 'Regular', blob: () => Promise.resolve(new Blob([cff])) },
      { family: 'Outlines', style: 'Bold', blob: () => Promise.resolve(new Blob([cff2])) },
    ]),
  );
  await source.list();
  const files = await source.load('Outlines');
  expect(files.map(({ face }) => face.weight)).toEqual([400, 700]);
  expect(Buffer.from(files[0]?.bytes ?? new ArrayBuffer(0)).equals(cff)).toBe(true);
  expect(Buffer.from(files[1]?.bytes ?? new ArrayBuffer(0)).equals(cff2)).toBe(true);

  const variable = Buffer.from(cff2);
  for (let index = 0; index < variable.readUInt16BE(4); index++) {
    const offset = 12 + index * 16;
    if (variable.toString('ascii', offset, offset + 4) === 'name')
      variable.write('fvar', offset, 'ascii');
  }
  const refused = new LocalFontSource(() =>
    Promise.resolve([
      { family: 'Variable', style: 'Regular', blob: () => Promise.resolve(new Blob([variable])) },
    ]),
  );
  await refused.list();
  await expect(refused.load('Variable')).rejects.toThrow('static TrueType or CFF');
});

it('skips a face whose directory looks static but which the parser cannot read', async () => {
  // An sfnt directory with one empty `glyf` record and none of the tables the parser needs.
  const directory = Buffer.alloc(12 + 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(1, 4);
  directory.write('glyf', 12, 'ascii');
  const source = new LocalFontSource(() =>
    Promise.resolve([
      { family: 'Broken', style: 'Regular', blob: () => Promise.resolve(new Blob([directory])) },
    ]),
  );
  await source.list();
  await expect(source.load('Broken')).rejects.toThrow('static TrueType or CFF');
});
