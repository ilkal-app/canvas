import { expect, it } from 'vitest';

import { parseFontCatalogue } from './remote-font-catalogue.js';

it('keeps approved self-hosted faces and refuses third-party and traversal URLs', () => {
  const face = { weight: 400, isItalic: false, url: 'example/400.ttf' };
  const entry = { family: 'Example', category: 'sans', licence: 'OFL-1.1', faces: [face] };
  const entries = [
    entry,
    { ...entry, licence: 'proprietary' },
    { ...entry, faces: [{ ...face, url: 'https://example.com/font.ttf' }] },
    { ...entry, faces: [{ ...face, url: '../example/400.ttf' }] },
    { ...entry, faces: [{ ...face, weight: 450 }] },
    null,
  ];
  expect(parseFontCatalogue({ version: 1, entries }, '/assets/fonts/')).toEqual([
    {
      family: 'Example',
      category: 'sans',
      faces: [{ ...face, family: 'Example', url: '/assets/fonts/example/400.ttf' }],
    },
  ]);
  expect(() => parseFontCatalogue(null, '/')).toThrow('Invalid font catalogue');
});

it('keeps a face of any of the nine weights', () => {
  const medium = { weight: 500, isItalic: false, url: 'example/500.ttf' };
  const entry = { family: 'Example', category: 'sans', licence: 'OFL-1.1', faces: [medium] };
  expect(parseFontCatalogue({ version: 1, entries: [entry] }, '/f/')).toEqual([
    {
      family: 'Example',
      category: 'sans',
      faces: [{ ...medium, family: 'Example', url: '/f/example/500.ttf' }],
    },
  ]);
});
