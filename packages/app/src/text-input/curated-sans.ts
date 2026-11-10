import { WEIGHTED_SANS_FONTS } from './curated-sans-weighted.js';
import { VARIABLE_FONTS } from './curated-variable.js';
import type { FontFamilyEntry } from './font-catalogue.js';

/** Bundled sans font faces from the approved library. */
export const SANS_FONTS: readonly FontFamilyEntry[] = [
  ...WEIGHTED_SANS_FONTS,
  ...VARIABLE_FONTS,
  {
    family: 'Open Sans',
    category: 'sans',
    faces: [
      {
        family: 'Open Sans',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/opensans/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Open Sans',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/opensans/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Open Sans',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/opensans/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Open Sans',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/opensans/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Lato',
    category: 'sans',
    faces: [
      {
        family: 'Lato',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/lato/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Lato',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/lato/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Lato',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/lato/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Lato',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/lato/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Montserrat',
    category: 'sans',
    faces: [
      {
        family: 'Montserrat',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/montserrat/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Montserrat',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/montserrat/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Montserrat',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/montserrat/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Montserrat',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/montserrat/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
  {
    family: 'Poppins',
    category: 'sans',
    faces: [
      {
        family: 'Poppins',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/poppins/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Poppins',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/poppins/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Poppins',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/poppins/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Poppins',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/poppins/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'DM Sans',
    category: 'sans',
    faces: [
      {
        family: 'DM Sans',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/dmsans/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'DM Sans',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/dmsans/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'DM Sans',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/dmsans/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'DM Sans',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/dmsans/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Work Sans',
    category: 'sans',
    faces: [
      {
        family: 'Work Sans',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/worksans/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Work Sans',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/worksans/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'Work Sans',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/worksans/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Work Sans',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/worksans/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Manrope',
    category: 'sans',
    faces: [
      {
        family: 'Manrope',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/manrope/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Manrope',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/manrope/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'Nunito',
    category: 'sans',
    faces: [
      {
        family: 'Nunito',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/nunito/400i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Nunito',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/nunito/700i.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Nunito',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/nunito/400.ttf?no-inline', import.meta.url).href,
      },
      {
        family: 'Nunito',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/nunito/700.ttf?no-inline', import.meta.url).href,
      },
    ],
  },
  {
    family: 'IBM Plex Sans',
    category: 'sans',
    faces: [
      {
        family: 'IBM Plex Sans',
        weight: 400,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ibmplexsans/400i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Sans',
        weight: 700,
        isItalic: true,
        url: new URL('../../assets/fonts/library/ibmplexsans/700i.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Sans',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ibmplexsans/400.ttf?no-inline', import.meta.url)
          .href,
      },
      {
        family: 'IBM Plex Sans',
        weight: 700,
        isItalic: false,
        url: new URL('../../assets/fonts/library/ibmplexsans/700.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
];
