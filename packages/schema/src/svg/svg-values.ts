// The attribute values an SVG import reads: transform lists, colours, lengths, numbers
// and point lists. Each reader returns `undefined` for a value it cannot read, and the import
// reports it. Pure.
import type { Rgba } from '../fields/color.js';
import type { Point } from '../fields/point.js';
import type { AffineMap } from '../geometry/affine-map.js';

import { composeMaps, IDENTITY } from './svg-geometry.js';

const NUMBER_SOURCE = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const NUMBER_ONLY = new RegExp(`^${NUMBER_SOURCE}$`);
const NUMBERS = new RegExp(NUMBER_SOURCE, 'g');
const LIST_SEPARATORS = /^[\s,]*$/;

/** The most characters of untrusted text a report quotes. */
const EXCERPT_LENGTH = 40;

/**
 * Shortens untrusted text for a report, so a hostile value cannot swell it.
 *
 * @param text - The text.
 * @returns At most 40 characters of it, with `…` when it was cut.
 */
export function excerpt(text: string): string {
  return text.length <= EXCERPT_LENGTH ? text : `${text.slice(0, EXCERPT_LENGTH)}…`;
}

/**
 * Reads a list of numbers separated by whitespace and/or commas.
 *
 * @param value - The list.
 * @returns The numbers, or undefined when anything else is in it.
 */
export function readNumberList(value: string): number[] | undefined {
  const numbers: number[] = [];
  let last = 0;
  for (const match of value.matchAll(NUMBERS)) {
    if (!LIST_SEPARATORS.test(value.slice(last, match.index))) return undefined;
    numbers.push(Number(match[0]));
    last = match.index + match[0].length;
  }
  return LIST_SEPARATORS.test(value.slice(last)) ? numbers : undefined;
}

/**
 * Reads a length in user units: a number, optionally in `px`. Other units (`em`, `%`, `mm`)
 * depend on a context the board does not have.
 *
 * @param value - The attribute value, or undefined when absent.
 * @returns The length, or undefined when absent or not a user-unit length.
 */
export function readLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/px$/, '');
  return NUMBER_ONLY.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * Reads a number or a percentage as a fraction (`50%` is 0.5), as gradient coordinates and stop
 * offsets are written.
 *
 * @param value - The value, or undefined when absent.
 * @returns The number, or undefined when absent or unreadable.
 */
export function readFraction(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const percent = trimmed.slice(0, -1);
    return NUMBER_ONLY.test(percent) ? Number(percent) / 100 : undefined;
  }
  return NUMBER_ONLY.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * Reads a `points` attribute: pairs of coordinates. An odd last number is dropped, as SVG does.
 *
 * @param value - The attribute.
 * @returns The points, or undefined when the list is unreadable.
 */
export function readPoints(value: string): Point[] | undefined {
  const numbers = readNumberList(value);
  if (numbers === undefined) return undefined;
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: Number(numbers[index]), y: Number(numbers[index + 1]) });
  }
  return points;
}

/**
 * The map of one transform function, or undefined when its arguments do not fit it.
 *
 * @param name - The function's name.
 * @param args - Its arguments.
 * @returns The map.
 */
function transformFunction(name: string, args: readonly number[]): AffineMap | undefined {
  const [first = 0, second, third] = args;
  const radians = (first * Math.PI) / 180;
  const count = args.length;
  switch (name) {
    case 'matrix': {
      if (count !== 6) return undefined;
      const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = args;
      return { a, b, c, d, x, y };
    }
    case 'translate':
      return count === 1 || count === 2 ? { ...IDENTITY, x: first, y: second ?? 0 } : undefined;
    case 'scale':
      return count === 1 || count === 2 ? { ...IDENTITY, a: first, d: second ?? first } : undefined;
    case 'rotate': {
      if (count !== 1 && count !== 3) return undefined;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const rotation = { a: cos, b: sin, c: -sin, d: cos, x: 0, y: 0 };
      const cx = second ?? 0;
      const cy = third ?? 0;
      return composeMaps(
        { ...IDENTITY, x: cx, y: cy },
        composeMaps(rotation, { ...IDENTITY, x: -cx, y: -cy }),
      );
    }
    case 'skewX':
      return count === 1 ? { ...IDENTITY, c: Math.tan(radians) } : undefined;
    default:
      return count === 1 ? { ...IDENTITY, b: Math.tan(radians) } : undefined;
  }
}

/**
 * Reads a `transform` attribute: a list of `matrix`, `translate`, `scale`, `rotate`, `skewX` and
 * `skewY`, applied right to left (the last function first), as SVG composes them.
 *
 * @param value - The attribute.
 * @returns The composed map, or undefined when the list is malformed.
 */
export function readTransform(value: string): AffineMap | undefined {
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let map = IDENTITY;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    if (!LIST_SEPARATORS.test(value.slice(last, match.index))) return undefined;
    const args = readNumberList(String(match[2]));
    const step = args === undefined ? undefined : transformFunction(String(match[1]), args);
    if (step === undefined) return undefined;
    map = composeMaps(map, step);
    last = match.index + match[0].length;
  }
  return LIST_SEPARATORS.test(value.slice(last)) ? map : undefined;
}

// The CSS named colours (CSS Color 4 §6.1), as `name` then six hex digits.
const NAMED_COLORS = new Map(
  (
    'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc ' +
    'bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a ' +
    'burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 ' +
    'cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b ' +
    'darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 ' +
    'darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 ' +
    'darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b ' +
    'darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 ' +
    'deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff ' +
    'firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ' +
    'ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f ' +
    'grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 ' +
    'khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd ' +
    'lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 ' +
    'lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a ' +
    'lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 ' +
    'lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 ' +
    'magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 ' +
    'mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a ' +
    'mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa ' +
    'mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 ' +
    'olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa ' +
    'palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 ' +
    'peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 ' +
    'rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 ' +
    'salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 ' +
    'skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa ' +
    'springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 ' +
    'turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 ' +
    'yellowgreen 9acd32'
  )
    .split(' ')
    .flatMap((word, index, words) =>
      index % 2 === 0 ? [[word, `#${String(words[index + 1])}`] as const] : [],
    ),
);

/**
 * Reads hex digits as a colour: 3, 4, 6 or 8 digits.
 *
 * @param hex - The digits, without `#`.
 * @returns The colour, or undefined.
 */
function hexColor(hex: string): Rgba | undefined {
  if (!/^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) return undefined;
  const full = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex;
  const values = Array.from({ length: full.length / 2 }, (unused, index) =>
    parseInt(full.slice(2 * index, 2 * index + 2), 16),
  );
  return [
    Number(values[0]) / 255,
    Number(values[1]) / 255,
    Number(values[2]) / 255,
    (values[3] ?? 255) / 255,
  ];
}

/**
 * Reads one channel of `rgb()`: a number in 0–255 or a percentage, clamped.
 *
 * @param value - The channel.
 * @returns The channel in [0, 1], or undefined.
 */
function rgbChannel(value: string): number | undefined {
  const fraction = readFraction(value);
  if (fraction === undefined) return undefined;
  return Math.min(1, Math.max(0, value.trim().endsWith('%') ? fraction : fraction / 255));
}

/**
 * Reads an alpha value: a number in 0–1 or a percentage, clamped.
 *
 * @param value - The alpha, or undefined for opaque.
 * @returns The alpha in [0, 1], or undefined when unreadable.
 */
function alphaChannel(value: string | undefined): number | undefined {
  const alpha = value === undefined ? 1 : readFraction(value);
  return alpha === undefined ? undefined : Math.min(1, Math.max(0, alpha));
}

/**
 * The sRGB channels of an HSL colour (CSS Color 4 §7.1).
 *
 * @param hue - Degrees.
 * @param saturation - 0 to 1.
 * @param lightness - 0 to 1.
 * @returns Red, green and blue in [0, 1].
 */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

/**
 * Reads a functional colour: `rgb()`/`rgba()` or `hsl()`/`hsla()`, comma or space separated,
 * with an optional alpha after a comma or `/`.
 *
 * @param name - The function's name, lowercase.
 * @param body - What is between its parentheses.
 * @returns The colour, or undefined.
 */
function functionalColor(name: string, body: string): Rgba | undefined {
  const parts = body
    .trim()
    .split(/\s*[,/]\s*|\s+/)
    .filter((part) => part !== '');
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const [first = '', second = '', third = '', fourth] = parts;
  const alpha = alphaChannel(fourth);
  if (name.startsWith('rgb')) {
    const channels = [first, second, third].map(rgbChannel);
    const [r, g, b] = channels;
    if (r === undefined || g === undefined || b === undefined || alpha === undefined) {
      return undefined;
    }
    return [r, g, b, alpha];
  }
  const hue = readFraction(first.replace(/deg$/, ''));
  const saturation = second.endsWith('%') ? readFraction(second) : undefined;
  const lightness = third.endsWith('%') ? readFraction(third) : undefined;
  if (hue === undefined || saturation === undefined || lightness === undefined) return undefined;
  if (alpha === undefined) return undefined;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const [r, g, b] = hslToRgb(((hue % 360) + 360) % 360, clamp(saturation), clamp(lightness));
  return [r, g, b, alpha];
}

/**
 * Reads a CSS colour as SVG takes it: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`,
 * `hsl()`, `hsla()`, a named colour or `transparent`. `currentColor` and `none` are the caller's.
 *
 * @param value - The colour.
 * @returns Straight-alpha sRGB in [0, 1], or undefined when unreadable.
 */
export function readColor(value: string): Rgba | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('#')) return hexColor(trimmed.slice(1));
  if (trimmed === 'transparent') return [0, 0, 0, 0];
  const call = /^(rgba?|hsla?)\((.*)\)$/.exec(trimmed);
  if (call !== null) return functionalColor(String(call[1]), String(call[2]));
  const named = NAMED_COLORS.get(trimmed);
  return named === undefined ? undefined : hexColor(named.slice(1));
}
