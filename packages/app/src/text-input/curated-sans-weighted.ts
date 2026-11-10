import type { FontFamilyEntry } from './font-catalogue.js';

/**
 * Bundled sans families that also supply upright 300, 500 and 600 (
 * `tooling/fonts/extra-weights.json`), in the library's order; `SANS_FONTS` lists them first.
 */
export const WEIGHTED_SANS_FONTS: readonly FontFamilyEntry[] = [
  {
    family: 'Geist',
    category: 'sans',
    faces: [
      {
        family: 'Geist',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/geist/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Geist',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/geist/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Geist',
        weight: 300,
        isItalic: false,
        url: new URL('../../assets/fonts/library/geist/300.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Geist',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/geist/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Geist',
        weight: 500,
        isItalic: false,
        url: new URL('../../assets/fonts/library/geist/500.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Geist',
        weight: 600,
        isItalic: false,
        url: new URL('../../assets/fonts/library/geist/600.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Geist',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/geist/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Inter',
    category: 'sans',
    faces: [
      {
        family: 'Inter',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/inter/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Inter',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/inter/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Inter',
        weight: 300,
        isItalic: false,
        url: new URL('../../assets/fonts/library/inter/300.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Inter',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/inter/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Inter',
        weight: 500,
        isItalic: false,
        url: new URL('../../assets/fonts/library/inter/500.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Inter',
        weight: 600,
        isItalic: false,
        url: new URL('../../assets/fonts/library/inter/600.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Inter',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/inter/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Roboto',
    category: 'sans',
    faces: [
      {
        family: 'Roboto',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/roboto/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Roboto',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/roboto/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Roboto',
        weight: 300,
        isItalic: false,
        url: new URL('../../assets/fonts/library/roboto/300.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Roboto',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/roboto/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Roboto',
        weight: 500,
        isItalic: false,
        url: new URL('../../assets/fonts/library/roboto/500.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Roboto',
        weight: 600,
        isItalic: false,
        url: new URL('../../assets/fonts/library/roboto/600.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Roboto',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/roboto/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
];
