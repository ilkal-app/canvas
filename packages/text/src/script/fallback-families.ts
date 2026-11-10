// The Noto face the app falls back to for each script: the table that replaced's
// list of script patterns. Han characters are shared by Chinese, Japanese and Korean, whose
// forms differ, so Han's faces follow the run's language.

import type { ScriptCode } from './script-table.js';

/**
 * Each script with a Noto face, and its family, in the order the faces were added. The
 * fonts fingerprint hashes these rows, so a change to a face marks stored sizes stale.
 */
export const SCRIPT_FALLBACKS: readonly (readonly [ScriptCode, string])[] = [
  ['Hani', 'Noto Sans SC'],
  ['Hira', 'Noto Sans JP'],
  ['Kana', 'Noto Sans JP'],
  ['Hang', 'Noto Sans KR'],
  ['Arab', 'Noto Sans Arabic'],
  ['Deva', 'Noto Sans Devanagari'],
  ['Hebr', 'Noto Sans Hebrew'],
  ['Thai', 'Noto Sans Thai'],
  ['Beng', 'Noto Sans Bengali'],
  ['Taml', 'Noto Sans Tamil'],
  ['Telu', 'Noto Sans Telugu'],
  ['Knda', 'Noto Sans Kannada'],
  ['Mlym', 'Noto Sans Malayalam'],
  ['Geor', 'Noto Sans Georgian'],
  ['Armn', 'Noto Sans Armenian'],
  ['Ethi', 'Noto Sans Ethiopic'],
  ['Khmr', 'Noto Sans Khmer'],
  ['Mymr', 'Noto Sans Myanmar'],
  ['Sinh', 'Noto Sans Sinhala'],
  ['Laoo', 'Noto Sans Lao'],
  // Every other script Noto has a face for on Google Fonts.
  ['Gujr', 'Noto Sans Gujarati'],
  ['Guru', 'Noto Sans Gurmukhi'],
  ['Orya', 'Noto Sans Oriya'],
  ['Tibt', 'Noto Serif Tibetan'],
  ['Mong', 'Noto Sans Mongolian'],
  ['Syrc', 'Noto Sans Syriac'],
  ['Thaa', 'Noto Sans Thaana'],
  ['Cher', 'Noto Sans Cherokee'],
  ['Cans', 'Noto Sans Canadian Aboriginal'],
  ['Tfng', 'Noto Sans Tifinagh'],
  ['Nkoo', 'Noto Sans NKo'],
  ['Vaii', 'Noto Sans Vai'],
  ['Adlm', 'Noto Sans Adlam'],
  ['Osma', 'Noto Sans Osmanya'],
  ['Bamu', 'Noto Sans Bamum'],
  ['Java', 'Noto Sans Javanese'],
  ['Bali', 'Noto Sans Balinese'],
  ['Lana', 'Noto Sans Tai Tham'],
  ['Tavt', 'Noto Sans Tai Viet'],
  ['Talu', 'Noto Sans New Tai Lue'],
  ['Tale', 'Noto Sans Tai Le'],
  ['Bugi', 'Noto Sans Buginese'],
  ['Cham', 'Noto Sans Cham'],
  ['Sund', 'Noto Sans Sundanese'],
  ['Batk', 'Noto Sans Batak'],
  ['Mtei', 'Noto Sans Meetei Mayek'],
  ['Olck', 'Noto Sans Ol Chiki'],
  ['Limb', 'Noto Sans Limbu'],
  ['Lepc', 'Noto Sans Lepcha'],
  ['Saur', 'Noto Sans Saurashtra'],
  ['Cakm', 'Noto Sans Chakma'],
  ['Kali', 'Noto Sans Kayah Li'],
  ['Yiii', 'Noto Sans Yi'],
  ['Lisu', 'Noto Sans Lisu'],
  ['Hmng', 'Noto Sans Pahawh Hmong'],
  ['Copt', 'Noto Sans Coptic'],
  ['Glag', 'Noto Sans Glagolitic'],
  ['Goth', 'Noto Sans Gothic'],
  ['Runr', 'Noto Sans Runic'],
  ['Ogam', 'Noto Sans Ogham'],
  ['Samr', 'Noto Sans Samaritan'],
  ['Mand', 'Noto Sans Mandaic'],
  ['Armi', 'Noto Sans Imperial Aramaic'],
  ['Phnx', 'Noto Sans Phoenician'],
  ['Xsux', 'Noto Sans Cuneiform'],
  ['Egyp', 'Noto Sans Egyptian Hieroglyphs'],
  ['Linb', 'Noto Sans Linear B'],
  ['Brah', 'Noto Sans Brahmi'],
  ['Khar', 'Noto Sans Kharoshthi'],
  ['Ital', 'Noto Sans Old Italic'],
  ['Xpeo', 'Noto Sans Old Persian'],
  ['Ugar', 'Noto Sans Ugaritic'],
  ['Shaw', 'Noto Sans Shavian'],
  ['Dsrt', 'Noto Sans Deseret'],
  ['Bopo', 'Noto Sans TC'],
];

/**
 * Names the rules that pick a face beyond the table: Han by language, and Japanese where a
 * paragraph holds kana. The fonts fingerprint hashes it, so a text measured under
 * other rules is told stale.
 */
export const FALLBACK_RULES = 'cluster;han-by-language;kana-paragraph-ja';

const FAMILIES_BY_SCRIPT = new Map(SCRIPT_FALLBACKS.map(([script, family]) => [script, [family]]));

/**
 * The emoji face: Noto Color Emoji, drawn from its COLRv1 paint. Emoji
 * are Common, so the symbol faces load it (`symbolCoverageFamilies`), and the fallback's
 * emoji-presentation step sends a cluster drawn as emoji to it first.
 */
export const EMOJI_FAMILY = 'Noto Color Emoji';

/** Han's faces by language: Japanese, Korean, Traditional Chinese, Hong Kong, else Simplified. */
const HAN_JAPANESE = ['Noto Sans JP', 'Noto Sans SC'] as const;
const HAN_KOREAN = ['Noto Sans KR', 'Noto Sans SC'] as const;
const HAN_TRADITIONAL = ['Noto Sans TC', 'Noto Sans SC'] as const;
const HAN_HONG_KONG = ['Noto Sans HK', 'Noto Sans TC', 'Noto Sans SC'] as const;

/** Every face Han may take by language, so the app bundles and loads each. */
export const HAN_LANGUAGE_FAMILIES: readonly string[] = [
  ...new Set([...HAN_JAPANESE, ...HAN_KOREAN, ...HAN_HONG_KONG]),
];
const HAN_SIMPLIFIED = ['Noto Sans SC'] as const;

/**
 * Han's faces, in order, for a language tag: `ja` Japanese forms, `ko` Korean, `zh-Hant`,
 * `zh-TW` and `zh-MO` Traditional Chinese, `zh-HK` Hong Kong, and anything else (or no tag)
 * Simplified Chinese; each falls back to Simplified Chinese, which the app always has.
 *
 * @param lang - A BCP 47 tag, or none.
 * @returns The families.
 */
function hanFamiliesOf(lang: string | undefined): readonly string[] {
  if (lang === undefined) return HAN_SIMPLIFIED;
  const [language = '', ...subtags] = lang.toLowerCase().split('-');
  if (language === 'ja') return HAN_JAPANESE;
  if (language === 'ko') return HAN_KOREAN;
  if (language !== 'zh') return HAN_SIMPLIFIED;
  if (subtags.includes('hk')) return HAN_HONG_KONG;
  if (subtags.includes('hant') || subtags.includes('tw') || subtags.includes('mo')) {
    return HAN_TRADITIONAL;
  }
  return HAN_SIMPLIFIED;
}

/**
 * The Noto families to try, in order, for text in a script. Han's follow the language; other
 * scripts' do not (kana is always Japanese, Hangul Korean).
 *
 * @param script - The script, an ISO 15924 short name.
 * @param lang - The text's language, a BCP 47 tag, if it has one.
 * @returns The families; none for a script the app has no face for.
 */
export function fallbackFamiliesOf(script: ScriptCode, lang?: string): readonly string[] {
  if (script === 'Hani') return hanFamiliesOf(lang);
  return FAMILIES_BY_SCRIPT.get(script) ?? [];
}
