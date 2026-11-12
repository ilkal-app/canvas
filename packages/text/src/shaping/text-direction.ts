// The horizontal direction HarfBuzz guesses for a stretch of text. harfbuzzjs guesses
// direction, script and language (`guessSegmentProperties`) but has no getter for the result, and
// layout needs the direction to place glyphs, so the guess is made here the way HarfBuzz makes it,
// then set on the buffer: the script is that of the first character whose script is not Common,
// Inherited or Unknown, and a script's direction is that of `hb_script_get_horizontal_direction`
// (HarfBuzz 14.5.0, src/hb-common.cc); a script written either way, or none, gives left to right.

/** The direction a stretch of text is laid out in. */
export type TextDirection = 'ltr' | 'rtl';

/** The scripts HarfBuzz 14.5.0 writes right to left, by their Unicode `Script` property names. */
const RTL_SCRIPTS = [
  'Arabic',
  'Hebrew',
  'Syriac',
  'Thaana',
  'Cypriot',
  'Kharoshthi',
  'Phoenician',
  'Nko',
  'Lydian',
  'Avestan',
  'Imperial_Aramaic',
  'Inscriptional_Pahlavi',
  'Inscriptional_Parthian',
  'Old_South_Arabian',
  'Old_Turkic',
  'Samaritan',
  'Mandaic',
  'Meroitic_Cursive',
  'Meroitic_Hieroglyphs',
  'Manichaean',
  'Mende_Kikakui',
  'Nabataean',
  'Old_North_Arabian',
  'Palmyrene',
  'Psalter_Pahlavi',
  'Hatran',
  'Adlam',
  'Hanifi_Rohingya',
  'Old_Sogdian',
  'Sogdian',
  'Elymaic',
  'Chorasmian',
  'Yezidi',
  'Old_Uyghur',
  'Garay',
  'Sidetic',
] as const;

/**
 * A pattern matching one character of any of the scripts, leaving out a script the runtime's
 * Unicode data does not know yet (a newer script than its ICU), which no character of it can be.
 *
 * @param scripts - The script names.
 * @returns The pattern.
 */
export function anyScript(scripts: readonly string[]): RegExp {
  const known = scripts.filter((script) => {
    try {
      return new RegExp(`\\p{Script=${script}}`, 'u').source.length > 0;
    } catch {
      return false;
    }
  });
  return new RegExp(`[${known.map((script) => `\\p{Script=${script}}`).join('')}]`, 'u');
}

const RTL = anyScript(RTL_SCRIPTS);

/**
 * A character with a script of its own: not Common, Inherited or Unknown. Unknown is written as
 * the categories it covers (unassigned, private use, surrogates): Safari 17 refuses the script
 * Unknown under every name (`Unknown`, `Zzzz`, `sc=`), and the app then fails to load.
 */
const SCRIPTED = /[^\p{Script=Common}\p{Script=Inherited}\p{Cn}\p{Co}\p{Cs}]/u;

/**
 * The direction HarfBuzz guesses for `text[start, end)`: right to left when the first character
 * with a script of its own is of a right-to-left script, else left to right. Pure.
 *
 * @param text - The text.
 * @param start - The first UTF-16 index.
 * @param end - One past the last UTF-16 index.
 * @returns The direction.
 */
export function guessDirection(text: string, start: number, end: number): TextDirection {
  let index = start;
  while (index < end) {
    const codepoint = text.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codepoint);
    if (SCRIPTED.test(character)) return RTL.test(character) ? 'rtl' : 'ltr';
    index += codepoint > 0xffff ? 2 : 1;
  }
  return 'ltr';
}
