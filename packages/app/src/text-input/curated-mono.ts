import type { FontFamilyEntry } from './font-catalogue.js';

/** Bundled mono font faces from the approved library. */
export const MONO_FONTS: readonly FontFamilyEntry[] = [
  {
    family: 'Geist Mono',
    category: 'mono',
    faces: [
      {
        family: 'Geist Mono',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/geistmono/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Geist Mono',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/geistmono/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Geist Mono',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/geistmono/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Geist Mono',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/geistmono/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'JetBrains Mono',
    category: 'mono',
    faces: [
      {
        family: 'JetBrains Mono',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/jetbrainsmono/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'JetBrains Mono',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/jetbrainsmono/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'JetBrains Mono',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/jetbrainsmono/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'JetBrains Mono',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/jetbrainsmono/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'IBM Plex Mono',
    category: 'mono',
    faces: [
      {
        family: 'IBM Plex Mono',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ibmplexmono/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Mono',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ibmplexmono/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Mono',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ibmplexmono/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Mono',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ibmplexmono/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Fira Code',
    category: 'mono',
    faces: [
      {
        family: 'Fira Code',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/firacode/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Fira Code',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/firacode/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
];
