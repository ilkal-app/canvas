import type { FontFamilyEntry } from './font-catalogue.js';

/** Static coverage fonts, loaded only when their script occurs in board text. */
export const COVERAGE_FONTS_1: readonly FontFamilyEntry[] = [
  {
    family: 'Noto Sans Telugu',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Telugu',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstelugu/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Telugu',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstelugu/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Kannada',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Kannada',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanskannada/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Kannada',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanskannada/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Malayalam',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Malayalam',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansmalayalam/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Malayalam',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansmalayalam/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Georgian',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Georgian',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansgeorgian/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Georgian',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansgeorgian/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Armenian',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Armenian',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansarmenian/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Armenian',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansarmenian/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Ethiopic',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Ethiopic',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansethiopic/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Ethiopic',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansethiopic/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Khmer',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Khmer',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanskhmer/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Khmer',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanskhmer/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
];
