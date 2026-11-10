// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ControlStatesSheet } from '../controls/control-states-sheet.js';

import { ICON_PATHS, type WhiteboardIconName } from './icon-paths.js';
import { Icon } from './icon.js';

const WHITEBOARD_NAMES = [
  'home',
  'minimap',
  'lasso',
  'highlighter',
  'reactions',
  'section',
  'timer',
  'vote',
] as const satisfies readonly WhiteboardIconName[];

const GALLERY_ICONS = [
  ['Home', 'home'],
  ['Minimap', 'minimap'],
  ['Lasso', 'lasso'],
  ['Highlighter', 'highlighter'],
  ['Reactions', 'reactions'],
  ['Section', 'section'],
  ['Timer', 'timer'],
  ['Vote', 'vote'],
  ['Pencil', 'pencil'],
  ['Marker', 'brush'],
  ['Eraser', 'eraser'],
] as const;

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Read all explicit end and control points in the path, resolving relative coordinates.
 *
 * @param pathData - SVG path data made of the supported stroke commands.
 * @returns Every reached point and control point.
 * @throws {Error} When the path contains an unsupported or incomplete command.
 */
function pathPoints(pathData: string): readonly Point[] {
  const tokenPattern = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const tokens = pathData.match(tokenPattern) ?? [];
  expect(tokens.join('')).toBe(pathData.replace(/[\s,]/g, ''));
  const points: Point[] = [];
  let tokenIndex = 0;
  let command = '';
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = current;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex];
    if (token === undefined) throw new Error('Unexpected end of path.');
    if (/^[a-zA-Z]$/.test(token)) {
      command = token;
      tokenIndex += 1;
    }
    const upperCommand = command.toUpperCase();
    if (!'MLHVCSQTZ'.includes(upperCommand) || command === '') {
      throw new Error(`Unsupported path command: ${command}`);
    }
    if (upperCommand === 'Z') {
      current = subpathStart;
      command = '';
      continue;
    }
    const parameterCount =
      upperCommand === 'H' || upperCommand === 'V'
        ? 1
        : upperCommand === 'C'
          ? 6
          : upperCommand === 'S' || upperCommand === 'Q'
            ? 4
            : 2;
    const values = tokens.slice(tokenIndex, tokenIndex + parameterCount).map(Number);
    if (values.length !== parameterCount || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Incomplete ${command} segment at token ${String(tokenIndex)}.`);
    }
    tokenIndex += parameterCount;
    const isRelative = command === command.toLowerCase();
    const origin = current;
    const segmentPoints: Point[] = [];
    if (upperCommand === 'H') {
      segmentPoints.push({ x: (values[0] ?? 0) + (isRelative ? origin.x : 0), y: origin.y });
    } else if (upperCommand === 'V') {
      segmentPoints.push({ x: origin.x, y: (values[0] ?? 0) + (isRelative ? origin.y : 0) });
    } else {
      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 2) {
        segmentPoints.push({
          x: (values[valueIndex] ?? 0) + (isRelative ? origin.x : 0),
          y: (values[valueIndex + 1] ?? 0) + (isRelative ? origin.y : 0),
        });
      }
    }
    points.push(...segmentPoints);
    const endPoint = segmentPoints.at(-1);
    if (endPoint === undefined) throw new Error('Path segment has no endpoint.');
    current = endPoint;
    if (upperCommand === 'M') {
      subpathStart = current;
      command = isRelative ? 'l' : 'L';
    }
  }
  return points;
}

afterEach(cleanup);

describe('whiteboard icon acceptance', () => {
  it.each(WHITEBOARD_NAMES)('%s is a stroked path contained in the 16-unit drawing box', (name) => {
    expect(Object.hasOwn(ICON_PATHS, name), name).toBe(true);
    const pathData = ICON_PATHS[name];
    expect(pathData, name).toMatch(/^M/);
    expect(pathData, name).not.toMatch(/(?:fill|stroke|<|>|=)/i);
    const points = pathPoints(pathData);
    expect(points.length, name).toBeGreaterThan(0);
    for (const { x, y } of points) {
      expect(x, `${name}: x coordinate ${String(x)}`).toBeGreaterThanOrEqual(0);
      expect(x, `${name}: x coordinate ${String(x)}`).toBeLessThanOrEqual(16);
      expect(y, `${name}: y coordinate ${String(y)}`).toBeGreaterThanOrEqual(0);
      expect(y, `${name}: y coordinate ${String(y)}`).toBeLessThanOrEqual(16);
    }
  });

  it.each(WHITEBOARD_NAMES)('%s renders as one 20 px outline SVG', (name) => {
    const { container } = render(<Icon name={name} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    const paths = svg?.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths?.[0]?.getAttribute('d')).toBe(ICON_PATHS[name]);
    expect(paths?.[0]?.getAttribute('stroke-width')).toBe('1.5');
    expect(paths?.[0]?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(paths?.[0]?.getAttribute('fill')).not.toBe('currentColor');
  });

  it('shows all eleven named icons in the floating control sheet', () => {
    render(<ControlStatesSheet chrome="floating" />);
    const row = screen.getByRole('region', { name: 'Whiteboard icons' });
    expect(within(row).getAllByRole('img')).toHaveLength(GALLERY_ICONS.length);
    for (const [label, iconName] of GALLERY_ICONS) {
      const image = within(row).getByRole('img', { name: label });
      const svgs = image.querySelectorAll('svg');
      expect(svgs, label).toHaveLength(1);
      expect(svgs[0]?.getAttribute('data-icon')).toBe(iconName);
    }
  });

  it('omits the whiteboard icon row from the classic control sheet', () => {
    render(<ControlStatesSheet chrome="classic" />);
    expect(screen.queryByRole('region', { name: 'Whiteboard icons' })).toBeNull();
  });
});
