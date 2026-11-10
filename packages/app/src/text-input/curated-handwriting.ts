import type { FontFamilyEntry } from './font-catalogue.js';

/** Bundled handwriting font faces from the approved library. */
export const HANDWRITING_FONTS: readonly FontFamilyEntry[] = [
  {
    family: 'Caveat',
    category: 'handwriting',
    faces: [
      {
        family: 'Caveat',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/caveat/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Caveat',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/caveat/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Kalam',
    category: 'handwriting',
    faces: [
      {
        family: 'Kalam',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/kalam/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Kalam',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/kalam/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Patrick Hand',
    category: 'handwriting',
    faces: [
      {
        family: 'Patrick Hand',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/patrickhand/400.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Indie Flower',
    category: 'handwriting',
    faces: [
      {
        family: 'Indie Flower',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/indieflower/400.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
];
