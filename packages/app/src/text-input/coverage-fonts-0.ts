import type { FontFamilyEntry } from './font-catalogue.js';

/** Static coverage fonts, loaded only when their script occurs in board text. */
export const COVERAGE_FONTS_0: readonly FontFamilyEntry[] = [
  {
    family: 'Noto Sans Arabic',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Arabic',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansarabic/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Arabic',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansarabic/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Devanagari',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Devanagari',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansdevanagari/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Devanagari',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansdevanagari/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Hebrew',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Hebrew',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanshebrew/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Hebrew',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanshebrew/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Thai',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Thai',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansthai/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Thai',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansthai/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Bengali',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Bengali',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansbengali/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Bengali',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansbengali/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Tamil',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Tamil',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstamil/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Tamil',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstamil/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
];
