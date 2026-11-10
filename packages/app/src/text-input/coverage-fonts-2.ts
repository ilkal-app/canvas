import type { FontFamilyEntry } from './font-catalogue.js';

/** Static coverage fonts, loaded only when their script occurs in board text. */
export const COVERAGE_FONTS_2: readonly FontFamilyEntry[] = [
  {
    family: 'Noto Sans Myanmar',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Myanmar',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansmyanmar/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Myanmar',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansmyanmar/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Sinhala',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Sinhala',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanssinhala/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Sinhala',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanssinhala/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Lao',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Lao',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanslao/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Lao',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanslao/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
];
