import { describe, expect, it } from 'vitest';

interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}
interface PickerMath {
  readonly hsvToHex: (h: number, s: number, v: number) => string;
  readonly hexToHsv: (hex: string) => Hsv;
}

async function math(): Promise<PickerMath> {
  const modulePath = './colour-picker-math.js';
  return (await import(/* @vite-ignore */ modulePath)) as PickerMath;
}

describe('HSV and hex colour conversion acceptance', () => {
  it.each([
    { name: 'red', hsv: { h: 0, s: 1, v: 1 }, hex: '#ff0000' },
    { name: 'green', hsv: { h: 120, s: 1, v: 1 }, hex: '#00ff00' },
    { name: 'blue', hsv: { h: 240, s: 1, v: 1 }, hex: '#0000ff' },
    { name: 'grey', hsv: { h: 0, s: 0, v: 128 / 255 }, hex: '#808080' },
    { name: 'black', hsv: { h: 0, s: 0, v: 0 }, hex: '#000000' },
    { name: 'white', hsv: { h: 0, s: 0, v: 1 }, hex: '#ffffff' },
  ])('converts $name between HSV and lower-case hex', async ({ hsv, hex }) => {
    const { hsvToHex, hexToHsv } = await math();
    expect(hsvToHex(hsv.h, hsv.s, hsv.v)).toBe(hex);
    const actual = hexToHsv(hex);
    expect(actual.h).toBeCloseTo(hsv.h, 5);
    expect(actual.s).toBeCloseTo(hsv.s, 5);
    expect(actual.v).toBeCloseTo(hsv.v, 5);
  });

  it('rounds a half channel upward and wraps hue 360 to red', async () => {
    const { hsvToHex } = await math();
    expect(hsvToHex(0, 1, 0.5)).toBe('#800000');
    expect(hsvToHex(0, 0.25, 0.25)).toBe('#403030');
    expect(hsvToHex(360, 1, 1)).toBe('#ff0000');
  });

  it.each(['#123456', '#3366cc', '#abcdef', '#ffffff', '#000000'])(
    'round-trips %s',
    async (hex) => {
      const { hsvToHex, hexToHsv } = await math();
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    },
  );
});
