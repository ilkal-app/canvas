import { describe, expect, it } from 'vitest';

import { mapPoint } from '../geometry/affine-map.js';

import {
  readColor,
  readFraction,
  readLength,
  readNumberList,
  readPoints,
  readTransform,
} from './svg-values.js';

function mapped(transform: string, x: number, y: number): { x: number; y: number } {
  const map = readTransform(transform);
  if (map === undefined) throw new Error(`unreadable: ${transform}`);
  const point = mapPoint(map, { x, y });
  return { x: Number(point.x.toFixed(9)), y: Number(point.y.toFixed(9)) };
}

describe('readNumberList, readLength, readFraction, readPoints', () => {
  it('reads numbers separated by spaces and commas, refusing anything else', () => {
    expect(readNumberList(' 1, 2 -3.5e1,.5 ')).toEqual([1, 2, -35, 0.5]);
    expect(readNumberList('')).toEqual([]);
    expect(readNumberList('1 x 2')).toBeUndefined();
    expect(readNumberList('1 2 x')).toBeUndefined();
  });

  it('reads user-unit lengths only', () => {
    expect(readLength('24')).toBe(24);
    expect(readLength(' 12.5px ')).toBe(12.5);
    expect(readLength(undefined)).toBeUndefined();
    expect(readLength('1em')).toBeUndefined();
    expect(readLength('50%')).toBeUndefined();
  });

  it('reads numbers and percentages as fractions', () => {
    expect(readFraction('0.25')).toBe(0.25);
    expect(readFraction('50%')).toBe(0.5);
    expect(readFraction(undefined)).toBeUndefined();
    expect(readFraction('x%')).toBeUndefined();
    expect(readFraction('x')).toBeUndefined();
  });

  it('reads point lists, dropping an odd last number', () => {
    expect(readPoints('0,0 10,0 10 10 5')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(readPoints('0,0 a')).toBeUndefined();
  });
});

describe('readTransform', () => {
  it('reads each transform function', () => {
    expect(mapped('translate(10)', 1, 1)).toEqual({ x: 11, y: 1 });
    expect(mapped('translate(10, 20)', 1, 1)).toEqual({ x: 11, y: 21 });
    expect(mapped('scale(2)', 1, 3)).toEqual({ x: 2, y: 6 });
    expect(mapped('scale(2 -1)', 1, 3)).toEqual({ x: 2, y: -3 });
    expect(mapped('rotate(90)', 1, 0)).toEqual({ x: 0, y: 1 });
    expect(mapped('rotate(90 10 10)', 10, 0)).toEqual({ x: 20, y: 10 });
    expect(mapped('skewX(45)', 0, 1)).toEqual({ x: 1, y: 1 });
    expect(mapped('skewY(45)', 1, 0)).toEqual({ x: 1, y: 1 });
    expect(mapped('matrix(1 2 3 4 5 6)', 1, 1)).toEqual({ x: 9, y: 12 });
  });

  it('applies a list right to left', () => {
    // Scale first, then translate.
    expect(mapped('translate(10 0) scale(2)', 1, 1)).toEqual({ x: 12, y: 2 });
    expect(mapped('scale(2),translate(10 0)', 1, 1)).toEqual({ x: 22, y: 2 });
    expect(mapped('', 3, 4)).toEqual({ x: 3, y: 4 });
  });

  it('refuses malformed lists and wrong argument counts', () => {
    for (const bad of [
      'translate(1 2 3)',
      'scale()',
      'rotate(1 2)',
      'skewX(1 2)',
      'skewY()',
      'matrix(1 2 3)',
      'translate(a)',
      'spin(3)',
      'translate(1) x',
      'x translate(1)',
    ]) {
      expect(readTransform(bad), bad).toBeUndefined();
    }
  });
});

describe('readColor', () => {
  it('reads hex colours of 3, 4, 6 and 8 digits', () => {
    expect(readColor('#f00')).toEqual([1, 0, 0, 1]);
    expect(readColor('#F008')).toEqual([1, 0, 0, 0x88 / 255]);
    expect(readColor('#336699')).toEqual([0.2, 0.4, 0.6, 1]);
    expect(readColor('#33669900')).toEqual([0.2, 0.4, 0.6, 0]);
    expect(readColor('#12345')).toBeUndefined();
    expect(readColor('#ggg')).toBeUndefined();
  });

  it('reads rgb(), rgba(), hsl() and hsla() in comma and space syntax', () => {
    expect(readColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2, 1]);
    expect(readColor('rgba(255,0,0,0.5)')).toEqual([1, 0, 0, 0.5]);
    expect(readColor('rgb(100% 0% 300 / 25%)')).toEqual([1, 0, 1, 0.25]);
    expect(readColor('hsl(120, 100%, 50%)')).toEqual([0, 1, 0, 1]);
    expect(readColor('hsla(-120deg 100% 50% / 0.5)')).toEqual([0, 0, 1, 0.5]);
    expect(readColor('hsl(0, 0%, 100%)')).toEqual([1, 1, 1, 1]);
    for (const bad of [
      'rgb(1, 2)',
      'rgb(1, 2, x)',
      'rgba(1, 2, 3, x)',
      'hsl(x, 1%, 1%)',
      'hsl(1, 1, 1%)',
      'hsl(1, 1%, 1)',
      'hsla(1, 1%, 1%, x)',
    ]) {
      expect(readColor(bad), bad).toBeUndefined();
    }
  });

  it('reads named colours and transparent, case-insensitively', () => {
    expect(readColor('RebeccaPurple')).toEqual([0x66 / 255, 0.2, 0.6, 1]);
    expect(readColor('yellowgreen')).toEqual([0x9a / 255, 0xcd / 255, 0x32 / 255, 1]);
    expect(readColor('aliceblue')).toEqual([0xf0 / 255, 0xf8 / 255, 1, 1]);
    expect(readColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(readColor('notacolour')).toBeUndefined();
  });
});
