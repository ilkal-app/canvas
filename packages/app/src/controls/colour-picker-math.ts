/** A colour by hue (degrees, 0 to 360), saturation and value (brightness), each 0 to 1. */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

/**
 * A channel, 0 to 1, as two lower-case hex digits, rounded half up.
 *
 * @param channel - The channel.
 * @returns Its digits.
 */
function hexDigits(channel: number): string {
  const byte = Math.min(255, Math.max(0, Math.floor(channel * 255 + 0.5)));
  return byte.toString(16).padStart(2, '0');
}

/**
 * The hex colour of a hue, saturation and brightness ('s colour picker). Pure.
 *
 * @param h - The hue, degrees; 360 is red again.
 * @param s - The saturation, 0 to 1.
 * @param v - The brightness, 0 to 1.
 * @returns Lower-case `#rrggbb`, each channel rounded half up.
 */
export function hsvToHex(h: number, s: number, v: number): string {
  const sector = (((h % 360) + 360) % 360) / 60;
  const channel = (offset: number): number => {
    const k = (offset + sector) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${hexDigits(channel(5))}${hexDigits(channel(3))}${hexDigits(channel(1))}`;
}

/**
 * The hue, saturation and brightness of a hex colour ('s colour picker): a grey's hue is 0.
 * Pure.
 *
 * @param hex - `#rrggbb`.
 * @returns Its hue, saturation and brightness.
 */
export function hexToHsv(hex: string): Hsv {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  let h = 0;
  if (range > 0) {
    if (max === r) h = ((g - b) / range + 6) % 6;
    else if (max === g) h = (b - r) / range + 2;
    else h = (r - g) / range + 4;
  }
  return { h: h * 60, s: max === 0 ? 0 : range / max, v: max };
}
