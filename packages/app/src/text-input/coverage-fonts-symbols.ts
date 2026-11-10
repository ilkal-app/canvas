import type { FontFamilyEntry } from './font-catalogue.js';

/**
 * Static symbol coverage fonts, loaded only when board text holds symbols: Noto Sans
 * Math and Noto Sans Symbols 2, regular only (neither family has a bold), and the emoji face,
 * Noto Color Emoji (COLRv1, regular only), for emoji drawn as emoji.
 */
export const SYMBOL_COVERAGE_FONTS: readonly FontFamilyEntry[] = [
  {
    family: 'Noto Sans Math',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Math',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosansmath/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Sans Symbols 2',
    category: 'sans',
    faces: [
      {
        family: 'Noto Sans Symbols 2',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notosanssymbols2/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
  {
    family: 'Noto Color Emoji',
    category: 'sans',
    faces: [
      {
        family: 'Noto Color Emoji',
        weight: 400,
        isItalic: false,
        url: new URL(
          '../../assets/fonts/script-coverage/notocoloremoji/400.ttf?no-inline',
          import.meta.url,
        ).href,
      },
    ],
  },
];
