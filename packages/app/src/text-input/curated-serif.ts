import type { FontFamilyEntry } from './font-catalogue.js';

/** Bundled serif font faces from the approved library. */
export const SERIF_FONTS: readonly FontFamilyEntry[] = [
  {
    family: 'Source Serif 4',
    category: 'serif',
    faces: [
      {
        family: 'Source Serif 4',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/sourceserif4/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Source Serif 4',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/sourceserif4/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Source Serif 4',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/sourceserif4/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Source Serif 4',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/sourceserif4/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Merriweather',
    category: 'serif',
    faces: [
      {
        family: 'Merriweather',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/merriweather/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Merriweather',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/merriweather/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Merriweather',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/merriweather/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Merriweather',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/merriweather/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Lora',
    category: 'serif',
    faces: [
      {
        family: 'Lora',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/lora/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Lora',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/lora/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Lora',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/lora/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Lora',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/lora/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Playfair Display',
    category: 'serif',
    faces: [
      {
        family: 'Playfair Display',
        weight: 400,
        isItalic: true,
        url: new URL(
          '../../assets/fonts/library/playfairdisplay/400i.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Playfair Display',
        weight: 700,
        isItalic: true,
        url: new URL(
          '../../assets/fonts/library/playfairdisplay/700i.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Playfair Display',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/library/playfairdisplay/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Playfair Display',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/library/playfairdisplay/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'EB Garamond',
    category: 'serif',
    faces: [
      {
        family: 'EB Garamond',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ebgaramond/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'EB Garamond',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ebgaramond/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'EB Garamond',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ebgaramond/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'EB Garamond',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ebgaramond/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Fraunces',
    category: 'serif',
    faces: [
      {
        family: 'Fraunces',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/fraunces/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Fraunces',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/fraunces/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Fraunces',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/fraunces/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Fraunces',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/fraunces/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'IBM Plex Serif',
    category: 'serif',
    faces: [
      {
        family: 'IBM Plex Serif',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ibmplexserif/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Serif',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ibmplexserif/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Serif',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ibmplexserif/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Serif',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ibmplexserif/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
];
