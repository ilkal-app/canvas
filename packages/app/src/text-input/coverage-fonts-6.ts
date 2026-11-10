import type { FontFamilyEntry } from './font-catalogue.js';

/** Static coverage fonts, loaded only when their script occurs in board text. */
export const COVERAGE_FONTS_6: readonly FontFamilyEntry[] = [
  {
    family: 'Noto Sans Syriac',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Syriac',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanssyriac/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Syriac',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanssyriac/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Tai Le',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Tai Le',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstaile/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Tai Tham',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Tai Tham',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstaitham/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Tai Tham',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstaitham/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Tai Viet',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Tai Viet',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstaiviet/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Thaana',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Thaana',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansthaana/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Sans Thaana',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansthaana/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Tifinagh',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Tifinagh',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanstifinagh/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Ugaritic',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Ugaritic',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansugaritic/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Vai',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Vai',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansvai/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Yi',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Yi',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansyi/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Serif Tibetan',
    category: 'serif',
    faces: [
      {
        family: 'Noto Serif Tibetan',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notoseriftibetan/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
      {
        family: 'Noto Serif Tibetan',
        weight: 700,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notoseriftibetan/700.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
];
