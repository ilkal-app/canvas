import type { FontFamilyEntry } from './font-catalogue.js';

/** Bundled display font faces from the approved library. */
export const DISPLAY_FONTS: readonly FontFamilyEntry[] = [
  {
    family: 'Space Grotesk',
    category: 'display',
    faces: [
      {
        family: 'Space Grotesk',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/spacegrotesk/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Space Grotesk',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/spacegrotesk/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Oswald',
    category: 'display',
    faces: [
      {
        family: 'Oswald',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/oswald/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Oswald',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/oswald/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Bebas Neue',
    category: 'display',
    faces: [
      {
        family: 'Bebas Neue',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/bebasneue/400.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Archivo Black',
    category: 'display',
    faces: [
      {
        family: 'Archivo Black',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/archivoblack/400.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
];
